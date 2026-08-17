# P2：生产容器最小权限与磁盘保护

> 状态：已实施并完成隔离环境实测  
> 验证日期：2026-08-15  
> 目标场景：单机 PostgreSQL 17、约 100 名受邀用户

## 1. 已落地的边界

| 服务 | 身份与文件系统 | Linux 权限 | 进程上限 | 日志上限 |
|---|---|---|---:|---:|
| `api` | `node`（UID/GID 1000），根文件系统只读；`/tmp` 为 64 MiB tmpfs | `no-new-privileges`，丢弃全部 capabilities | 128 | `json-file`，10 MiB × 3 |
| `web` | 根文件系统只读；`/tmp`、`/data`、`/config` 为 tmpfs | `no-new-privileges`，丢弃全部 capabilities，仅恢复绑定 80/443 所需的 `NET_BIND_SERVICE` | 64 | `json-file`，10 MiB × 3 |
| `postgres` | PostgreSQL 官方镜像用户模型；数据目录为持久卷 | `no-new-privileges` | 256 | `json-file`，10 MiB × 3 |
| `certbot` | 仅工具 profile；证书与 challenge 目录可写 | `no-new-privileges`，丢弃全部 capabilities | 64 | `json-file`，10 MiB × 3 |

API 的 tmpfs 带 `noexec,nosuid,nodev`，并把 `HOME` 与缓存目录指向 `/tmp`。四个生产服务的 Docker stdout/stderr 日志均有界；按配置每个服务最多保留约 30 MiB，四个服务理论上限约 120 MiB（不含 Docker 元数据及应用写入的其他文件）。轮转后，较早的 `docker logs` 内容会被覆盖。

PostgreSQL 没有强行设置只读根文件系统或 `cap_drop: ALL`。官方首次初始化入口需要创建目录、修正数据卷权限并切换数据库用户；在没有为目标 VPS 制作并长期维护定制入口的前提下，强制这两项会破坏 fresh volume 启动。数据库仍不映射宿主端口，并受到内部网络、`no-new-privileges`、内存、PID 和日志边界保护。

未设置 CPU 限额。容器 CPU 配额要依据目标 VPS 上真实的生成延迟、SSE 数量和数据库等待数据决定；本次没有用未经压测的数字制造超时。

## 2. API 镜像与运行依赖

Dockerfile 使用独立的 `production-dependencies` 阶段，只安装 API 的生产依赖；编译器、Jest、ESLint、Nest CLI 及 Web 依赖不会进入运行镜像。Prisma CLI 被明确列为 API 生产依赖，因为当前单镜像启动序列必须先执行 `prisma migrate deploy`。Agent 的打包 skill 文件也保留在 `dist` 中并经过运行时加载验证。

| 指标 | 修改前镜像 | 修改后候选镜像 | 变化 |
|---|---:|---:|---:|
| `docker image ls` 显示大小 | 1.17 GB | 801 MB | -31.5% |
| Docker inspect 内容大小 | 235,267,673 B | 183,318,532 B | -22.1% |
| `/app/node_modules` | 646 MB | 342 MB | -47.1% |
| `node_modules` 顶层目录数 | 598 | 162 | -72.9% |
| 运行用户 | root | `node`（1000:1000） | 消除 root API |

评估过拆分独立 migrator。当前 Prisma CLI 本身约 67 MB，但拆分会新增一个需要构建、分发、按顺序执行和失败恢复的部署镜像，并在主机上保留重复的 Node/Prisma 层；对单机 V1 的总磁盘与发布可靠性没有净收益。因此保留一个经过验证的非 root API 镜像，入口为“迁移成功后 `exec node`”。若未来使用外部 CI/CD 一次性迁移或多副本滚动发布，再把迁移拆为独立 job。

## 3. 隔离环境实测数据

测试使用独立 Compose project `ids-p2-hardening-260815a`、独立网络与独立 PostgreSQL volume、安全占位密钥和 `DEMO_MODE=true`；没有连接或修改现有 dev/prod 容器、数据卷与真实密钥。

| 验证项 | 实际结果 |
|---|---|
| fresh PostgreSQL | `postgres:17-alpine` healthy；10/10 migrations 首次应用成功 |
| 重启迁移 | 输出 `10 migrations found`、`No pending migrations to apply` |
| API readiness | `/api/health/ready` 返回 HTTP 200，`mode=demo` |
| 运行身份 | `uid=1000(node) gid=1000(node)`；PID 1 为 `node apps/api/dist/main.js` |
| 内核权限 | `CapEff=0`，`NoNewPrivs=1`；cgroup `pids.max=128` |
| 只读验证 | 写 `/app/readonly-probe` 返回 `Read-only file system`；写 `/tmp/write-probe` 成功 |
| Demo 基础链路 | 访问码授权、建项目、ALTCHA、PREMISE 入队和轮询全部成功；Job `SUCCEEDED`、attempt 1 |
| Agent skill | 容器内加载 `premise@1.0.0` 成功 |
| 数据一致性 | 两次 Demo 流程均得到 Project 2、Job `SUCCEEDED` 2、Run `COMPLETED` 2、Version `STAGING` 2 |
| Web | 同等安全参数启动，Caddy 可写 tmpfs 配置，隔离网络 HTTP 200（604 B HTML） |
| SIGTERM | 直接向 API 容器发送 SIGTERM，退出码 0，空闲退出耗时 261 ms |
| 回归 | API 24 suites / 205 tests 全部通过 |

测试后精确删除了该 project 的容器、网络、测试 volume、临时候选镜像与安全占位环境文件，并复核现有 dev/prod Compose project 未被触碰。

## 4. 发布与核验

发布前先验证配置完整：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

随后核验 API 实际约束，而不只检查 YAML：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api id
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api \
  sh -c 'cat /proc/1/status | grep -E "^(Uid|Gid|CapEff|NoNewPrivs):"'
docker inspect idea2screenplay-prod-api-1 \
  --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} pids={{.HostConfig.PidsLimit}} security={{json .HostConfig.SecurityOpt}} caps={{json .HostConfig.CapDrop}} log={{json .HostConfig.LogConfig}}'
curl --fail --silent https://<PUBLIC_IP>/api/health/ready
```

发布日志必须出现迁移成功或 `No pending migrations to apply`，随后才出现 Nest 应用启动完成。若迁移失败，API 进程不会启动或接受流量；先修复数据库/迁移问题，不要绕过入口命令。

## 5. 运维注意事项

- API 根文件系统只读；临时文件只能放 `/tmp`，重建容器后会消失，不能把业务数据写入其中。
- Web 的 `/data`、`/config` 也是临时内存目录；TLS 证书的持久数据仍以只读方式从 `deploy/certbot/conf` 挂载给 Web。
- `pids_limit` 限制线程与进程总数。若目标机压力测试出现 `pthread_create`、`EAGAIN` 或 cgroup PID 告警，先记录并发与峰值，再有依据地调整。
- 每次发布都检查 `docker compose ps`、ready 端点、迁移日志和磁盘；日志轮转不是监控与备份的替代品。
- Docker socket 未挂入任何业务容器；不要为了调试临时添加它。

