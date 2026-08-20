# 固定公网 IP 部署手册

> 目标：在一台香港 Linux 服务器上，通过 `https://<固定公网 IPv4>` 展示 Idea / Script；不购买域名。  
> 前提：服务器已安装 Docker Engine 与 Docker Compose Plugin，安全组开放 TCP 80、443 和受限来源的 SSH。

## 1. 准备生产环境变量

在服务器项目根目录创建 `.env.production`：

```dotenv
PUBLIC_IP=43.xxx.xxx.xxx
POSTGRES_USER=screenwriter
POSTGRES_PASSWORD=<使用 openssl rand -hex 24 生成>
POSTGRES_DB=idea2screenplay
COOKIE_SIGNING_KEY=<使用 openssl rand -hex 32 生成的当前签名密钥>
VISITOR_IDENTITY_KEY=<另用 openssl rand -hex 32 生成；身份建立后不得更改>
COOKIE_SIGNING_KEY_PREVIOUS=
IP_HASH_KEY=<使用 openssl rand -hex 32 生成>
ALTCHA_HMAC_KEY=<使用 openssl rand -hex 32 生成>

# 先在可信终端执行 npm run access-codes:generate -- 100，再粘贴整行
APP_ACCESS_CODES=IDS-001-...,...,IDS-100-...

# Phase 0 保持演示生成器，不产生模型费用
DEMO_MODE=true
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_TIMEOUT_MS=90000
```

使用十六进制口令可避免连接 URL 中的特殊字符编码问题。每位用户分配一个独立访问码；不要共用一个公共码。`.env.example` 中所有 `development-...` 密钥都是公开开发值，生产进程会拒绝它们，必须逐项生成独立随机密钥。`DEMO_MODE` 只有规范化后的 `true/false` 合法；只有明确 `false` 且 API Key 非空才允许真实付费调用。

`.env.production` 不提交到仓库，权限设置为 `chmod 600 .env.production`。该文件只作为 Compose 的运行时 `--env-file` 输入，禁止通过 Dockerfile 的 `COPY`、`ARG` 或 `ENV` 烘焙进镜像；根 `.dockerignore` 已排除 `.env` 和 `.env.*`，详见 `P1-DOCKER-BUILD-SECRET-ISOLATION.md`。

启动前必须检查生产配置能完整解析：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

生产 Compose 已启用容器最小权限和有界日志：API 使用非 root 用户、只读根文件系统、无 Linux capabilities，并只开放内存型 `/tmp`；Web 只保留绑定 80/443 所需的 capability；所有服务日志按 10 MiB × 3 轮转。完整边界、实测数据和发布后核验命令见 [P2-CONTAINER-HARDENING.md](./P2-CONTAINER-HARDENING.md)。不要在没有目标 VPS 压测数据时自行添加 CPU 配额。

## 2. 第一次以 HTTP 启动

证书签发前，先用 bootstrap 配置启动页面和 ACME challenge 目录：

```bash
mkdir -p deploy/certbot/www deploy/certbot/conf

docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  -f docker-compose.bootstrap.yml \
  up -d --build
```

此时访问 `http://<PUBLIC_IP>` 应能看到首页。确认防火墙没有拦截 80 端口。

## 3. 签发 HTTPS IP 地址证书

将下列命令中的邮箱和 IP 换成真实值：

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  run --rm certbot certonly \
  --non-interactive \
  --agree-tos \
  --email "you@example.com" \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --ip-address "43.xxx.xxx.xxx"
```

IP 地址证书有效期约 6 天。成功后，证书位于：

```text
deploy/certbot/conf/live/<PUBLIC_IP>/fullchain.pem
deploy/certbot/conf/live/<PUBLIC_IP>/privkey.pem
```

## 4. 切换到 HTTPS 配置

不再叠加 bootstrap 文件，重新创建 Web 容器：

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  up -d --force-recreate web
```

验证：

```bash
curl -I "https://43.xxx.xxx.xxx"
curl "https://43.xxx.xxx.xxx/api/health/ready"
```

浏览器应显示受信任的 HTTPS 连接，`http://<IP>` 会自动跳转到 `https://<IP>`。

## 5. 自动续期

IP 证书很短，必须每天检查续期。先手动验证：

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  run --rm certbot renew --dry-run
```

服务器的 root crontab 每天执行两次：

```cron
17 2,14 * * * cd /opt/idea2screenplay && docker compose --env-file .env.production -f docker-compose.prod.yml run --rm certbot renew --quiet && docker compose --env-file .env.production -f docker-compose.prod.yml exec -T web caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

将 `/opt/idea2screenplay` 换成服务器上的实际绝对路径。配置后观察至少一次真实续期，确认 Caddy 读取了新证书。

## 6. 更新发布

先构建镜像。构建本身不连接数据库：

```bash
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  build
```

API 容器启动时会执行 `prisma migrate deploy`，所以启动新容器前必须成功生成一个可恢复备份。用 `&&` 保持硬门禁，不能在备份失败后单独执行 `up -d`：

```bash
sudo ./scripts/backup-postgres.sh \
  --compose-file docker-compose.prod.yml \
  --env-file .env.production \
  --project-name idea2screenplay-prod \
  --database idea2screenplay \
  --backup-dir /var/backups/idea2screenplay/postgres \
  --keep 7 && \
docker compose \
  --env-file .env.production \
  -f docker-compose.prod.yml \
  up -d
```

这里的 `--database` 必须与 `.env.production` 的 `POSTGRES_DB` 完全一致。首次上线先按 [PostgreSQL 备份、隔离恢复与迁移前保护](./P2-DATABASE-BACKUP-RESTORE.md) 设置 root-only 目录、每日 cron，并完成一次隔离恢复演练。恢复脚本不会也不允许覆盖生产数据库。

查看状态与日志：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=200 api web postgres
```

发布后还要确认 API 实际以 UID 1000 运行、根文件系统只读且权限已丢弃：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api id
docker inspect idea2screenplay-prod-api-1 \
  --format 'user={{.Config.User}} readonly={{.HostConfig.ReadonlyRootfs}} pids={{.HostConfig.PidsLimit}} security={{json .HostConfig.SecurityOpt}} caps={{json .HostConfig.CapDrop}} log={{json .HostConfig.LogConfig}}'
```

API 容器每次启动会先以非 root 身份执行 `prisma migrate deploy`，迁移成功后通过 `exec` 让 Node 成为 PID 1。日志应出现“迁移已完成”或 `No pending migrations to apply`，随后 ready 才会变为健康。

## 7. Phase 0 验收

- `https://<IP>` 打开访问码门禁，有效码可以进入项目首页。
- 未授权项目 API 返回 401，错误访问码会被限流。
- 后端或模型不可用时，`/workspace/sample` 仍能浏览完整示例。
- 刷新 `/workspace/sample` 不返回 404。
- 手机网络和桌面网络均可访问。
- HTTP 自动跳转 HTTPS，证书的 Subject Alternative Name 是当前公网 IP。
- PostgreSQL 5432 与 NestJS 3000 没有映射到公网。
- `DEMO_MODE=true`，面试展示阶段不会产生模型费用。

## 8. 常见问题

### Caddy 启动时提示找不到证书

说明尚未成功执行第 3 步，或 `.env.production` 中的 `PUBLIC_IP` 与证书目录名不一致。临时恢复 bootstrap 配置，重新完成签发。

### Certbot 验证失败

确认公网 IP 属于当前服务器、80 端口可从公网访问、安全组和系统防火墙均已放行，并确认 bootstrap Web 容器正在运行。

### 更换了公网 IP

旧链接和旧证书立即失效。更新 `PUBLIC_IP`，删除对旧 IP 的依赖后，重新执行 bootstrap、签发和 HTTPS 切换流程。因此购买服务器时必须确认公网 IP 是固定地址。
