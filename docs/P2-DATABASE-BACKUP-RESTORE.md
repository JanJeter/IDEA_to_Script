# P2：PostgreSQL 备份、隔离恢复与迁移前保护

> 状态：已完成并通过 fresh PostgreSQL 17 实际恢复演练  
> 最后验证：2026-08-15（Asia/Shanghai）

## 结论

生产数据库现在有一条可执行、默认拒绝危险目标的恢复链路，不再只是“每天运行一次 `pg_dump`”的文字约定：

- [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh) 只从明确的 Compose 项目、唯一的 `postgres` 服务和显式数据库名读取；
- [`scripts/restore-postgres.sh`](../scripts/restore-postgres.sh) 只向 fresh、空的、带专用标签的 `postgres-restore` 服务恢复；
- [`scripts/verify-postgres-restore.sh`](../scripts/verify-postgres-restore.sh) 比对 migration、核心表计数和外键，并可验证隔离 API 的 `/api/health/ready`；
- [`docker-compose.restore.yml`](../docker-compose.restore.yml) 使用独立项目、独立卷、internal network 和不映射公网端口的恢复环境；
- 更新发布必须先成功产生备份，再允许新 API 容器启动并执行 `prisma migrate deploy`。

脚本故意不能覆盖生产数据库。真实灾难恢复也应先恢复到并行隔离卷，验证后再在维护窗口做人工切换；不要把“快速覆盖原卷”加入自动化。

## 安全边界

| 风险 | fail-closed 处理 |
|---|---|
| 选错 Compose 服务或库 | 读取并核对 Compose project/service label；数据库必须与显式 `--database` 及容器 `current_database()` 一致 |
| 不完整备份被当作成功 | `pg_dump --format=custom --compress=9` 写同目录临时文件；`pg_restore --list` 成功后才发布 |
| dump 与计数不是同一稳定窗口 | dump 前后各生成一次 migration/core/FK manifest；两份不同就不发布，等待下一次重试 |
| 崩溃留下“看似完整”的文件 | dump、manifest、checksum 都先写隐藏临时文件；checksum 最后通过同文件系统 `mv` 原子发布 |
| 文件损坏或替换 | checksum 文件只允许 dump 与 manifest 两个固定 basename，并逐个校验 SHA-256 |
| 备份被普通用户读取 | 脚本必须由 root 运行；目录 `0700`、三份文件 `0600`、owner UID 必须为 0 |
| 定时备份与发布备份重叠 | 备份目录使用非阻塞 `flock`；已有备份在运行时第二个进程直接退出非 0 |
| 保留策略误删其他文件 | 只匹配备份目录顶层的 `idea2screenplay_YYYYMMDDTHHMMSSZ.dump`；默认仅保留最新 7 个完整集合 |
| 误恢复生产 | 拒绝项目 `idea2screenplay-prod`；项目名必须含 `restore`；数据库名必须以 `_restore` 结尾 |
| 复用生产卷 | 容器必须有恢复专用 label，数据卷名必须含 `restore`，发现 `idea2screenplay_prod_pgdata` 就拒绝 |
| 覆盖已有数据 | 目标 public schema 只要存在一张普通表就拒绝；必须重新创建 fresh 隔离卷 |
| 恢复半成功 | `pg_restore --exit-on-error --single-transaction --no-owner --no-privileges`，失败时整次事务回滚 |
| 口令泄漏到命令或日志 | 脚本不 source、不读取、不打印环境文件；数据库工具在容器内读取已有 `POSTGRES_*` 环境变量 |

SHA-256 用于发现传输和磁盘损坏，不替代签名。能修改 root-only dump 和 checksum 的 root 本来就已拥有数据库控制权。当前 P2 也不是异地灾备或时间点恢复：同机只保留 7 份，V2 仍需加密对象存储副本与按需求评估 WAL/PITR。

## 生产每日备份

服务器部署完成后设置脚本和目录权限：

```bash
cd /opt/idea2screenplay
sudo chmod 0700 \
  scripts/backup-postgres.sh \
  scripts/restore-postgres.sh \
  scripts/verify-postgres-restore.sh
sudo install -d -m 0700 -o root -g root /var/backups/idea2screenplay/postgres
```

先手动运行一次；下面的 `idea2screenplay` 必须与 `.env.production` 的 `POSTGRES_DB` 完全一致：

```bash
sudo ./scripts/backup-postgres.sh \
  --compose-file docker-compose.prod.yml \
  --env-file .env.production \
  --project-name idea2screenplay-prod \
  --database idea2screenplay \
  --backup-dir /var/backups/idea2screenplay/postgres \
  --keep 7
```

root crontab 每天执行一次。脚本已有默认 7 份保留策略，不要另写宽泛的 `find ... -delete`：

```cron
23 3 * * * cd /opt/idea2screenplay && ./scripts/backup-postgres.sh --database idea2screenplay
```

监控脚本退出码和 `Backup complete`；只有 `.dump`、`.dump.manifest`、`.dump.sha256` 三者齐全才算一个可恢复备份。磁盘告警仍必须覆盖 `/var/backups`。

## 发布与 migration 门禁

镜像构建不会修改数据库，可以先完成。启动新 API 前必须使用 `&&` 把备份成功作为硬前置条件：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build

sudo ./scripts/backup-postgres.sh --database idea2screenplay && \
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

若 backup 因服务/数据库不匹配、DDL 锁等待、manifest 在 dump 窗口变化、磁盘写入或 checksum 校验失败而退出非 0，本次发布必须停止。不要单独重跑 `up -d` 绕过门禁。

## 月度隔离恢复演练

### 1. 创建 restore-only 环境文件

在 `/root/idea2screenplay-restore.env` 写入独立值并设为 `0600`。项目、卷、网络都要含 `restore`；数据库必须以 `_restore` 结尾；API 镜像应使用当时生产镜像的不可变 digest：

```dotenv
RESTORE_PROJECT_NAME=idea2screenplay-restore-202608
RESTORE_VOLUME_NAME=idea2screenplay_restore_202608_data
RESTORE_NETWORK_NAME=idea2screenplay-restore-202608-internal
RESTORE_POSTGRES_USER=restore_operator
RESTORE_POSTGRES_PASSWORD=<独立的十六进制随机口令>
RESTORE_POSTGRES_DB=idea2screenplay_restore

RESTORE_API_IMAGE=idea2screenplay-prod-api@sha256:<immutable-digest>
RESTORE_COOKIE_SIGNING_KEY=<restore-only-random-key-1>
RESTORE_VISITOR_IDENTITY_KEY=<restore-only-random-key-2>
RESTORE_IP_HASH_KEY=<restore-only-random-key-3>
RESTORE_ALTCHA_HMAC_KEY=<restore-only-random-key-4>
RESTORE_APP_ACCESS_CODE=<restore-only-code>
```

不要复用生产业务密钥。先验证 Compose 展开，但不要输出展开后的完整配置：

```bash
chmod 0600 /root/idea2screenplay-restore.env
docker compose \
  --env-file /root/idea2screenplay-restore.env \
  -f docker-compose.restore.yml \
  --profile api \
  config --quiet
```

### 2. 启动 fresh PostgreSQL 17 隔离目标

```bash
docker compose \
  --project-name idea2screenplay-restore-202608 \
  --env-file /root/idea2screenplay-restore.env \
  -f docker-compose.restore.yml \
  up -d postgres-restore
```

### 3. 恢复并验证数据库

选择同一完整集合中的 dump；脚本会验证相邻 manifest/checksum、空库、目标 label/卷以及显式确认文本：

```bash
sudo ./scripts/restore-postgres.sh \
  --compose-file docker-compose.restore.yml \
  --env-file /root/idea2screenplay-restore.env \
  --project-name idea2screenplay-restore-202608 \
  --database idea2screenplay_restore \
  --backup /var/backups/idea2screenplay/postgres/idea2screenplay_YYYYMMDDTHHMMSSZ.dump \
  --confirm RESTORE-INTO-ISOLATED-TARGET
```

成功输出必须含 `migrations`、`projects`、`visitors`、`foreign_keys` 和 `db_ready=yes`。恢复的 migration 集合必须同时等于备份 manifest 和当前仓库 migration 目录；若代码已经前移，应先取与备份匹配的代码/镜像完成恢复验证，再单独规划升级。

### 4. 启动隔离 API 并验证 ready

恢复成功后才启动 API；此服务不发布宿主端口：

```bash
docker compose \
  --project-name idea2screenplay-restore-202608 \
  --env-file /root/idea2screenplay-restore.env \
  -f docker-compose.restore.yml \
  --profile api \
  up -d api-restore

sudo ./scripts/verify-postgres-restore.sh \
  --compose-file docker-compose.restore.yml \
  --env-file /root/idea2screenplay-restore.env \
  --project-name idea2screenplay-restore-202608 \
  --database idea2screenplay_restore \
  --manifest /var/backups/idea2screenplay/postgres/idea2screenplay_YYYYMMDDTHHMMSSZ.dump.manifest \
  --ready-service api-restore
```

最终输出必须再含 `api_ready=yes`。验证后先核对项目 label 和卷名，再精确销毁这个 restore-only 栈；恢复出来的数据同样属于业务数据，不应长期遗留：

```bash
docker compose \
  --project-name idea2screenplay-restore-202608 \
  --env-file /root/idea2screenplay-restore.env \
  -f docker-compose.restore.yml \
  --profile api \
  down -v
```

## 2026-08-15 实际演练数据

本次不是 mock：创建了两套全新的隔离 PostgreSQL 17.10 源/目标卷。源库应用仓库全部 10 个 Prisma migration，写入 Visitor→Project→Version/Job/Run/ProviderCall、角色关系、地点、Beat、Scene 的真实外键样本，然后由交付脚本完成 dump 与 restore。没有读取或修改当前开发库、生产库或私有 `.env`。

| 项目 | 实测结果 |
|---|---:|
| 源 PostgreSQL | 17.10，逻辑源库约 9,180,851 bytes |
| custom-format dump | 54,989 bytes |
| manifest / checksum | 1,224 / 217 bytes |
| SHA-256 | `026ebbe2c68f609e40b8266606d202f85aedb24b644d2ae472121131f1cabe33` |
| 权限 | 三文件均 UID 0、mode `0600`；备份目录 `0700` |
| 临时残留 | 0 个 `.partial.*` |
| 恢复耗时 | 约 1.65 秒（小型隔离样本，不是生产容量承诺） |
| migrations | 10 / 10，失败或 rolled-back 为 0 |
| 关键计数 | Visitor 2、Project 1、Version/Job/Event/Run/ProviderCall 各 1 |
| 剧作投影计数 | Character 2、Relationship/Location/Beat/Scene 各 1 |
| 外键 | 22 个，unvalidated 0；源/目标数量一致 |
| DB ready | `pg_isready` PASS，PostgreSQL 17.10 |
| API ready | HTTP 200，`status=ok`、`generationMode=demo` |

负向测试全部按预期 exit 1：

- `--project-name idea2screenplay-prod`：`production Compose project is forbidden`；
- 缺少确认文本：`explicit --confirm ... is required`；
- 对已恢复的非空目标再次执行：`target database is not empty`；
- dump 追加 1 byte 后：SHA-256 mismatch，在连接目标进行恢复前拒绝。

三个 Bash 脚本均通过 `bash -n` 和 ShellCheck；`docker-compose.restore.yml` 使用 Compose v2.39.4 实际创建 internal network、fresh volume、PostgreSQL 与 API 并跑通恢复，另使用本机生产 Compose v5.1.4 执行 `config --quiet` 通过。演练结束后只清理名称以 `ids-p2-*` / `ids_p2_*` 开头且已核对 label 的测试容器、网络、卷、helper 镜像与临时 fixture，不清理其他 Docker 资源。

## 尚需运维落实

- 把 root cron 和退出码告警实际安装到目标 VPS；仓库无法替服务器安装系统定时任务。
- 每月执行一次完整恢复演练并记录结果，不能只检查文件存在或只运行 `sha256sum`。
- 7 份同机备份防误删和迁移事故，不防主机/磁盘整体损坏；上线稳定后增加加密异地副本。
- 匿名项目在线数据虽按 7 天清理，备份中的副本最多还会随 7 份保留窗口短暂存在，隐私说明和删除流程需写清这一点。
