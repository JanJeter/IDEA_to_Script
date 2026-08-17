# P1：Docker 构建上下文中的生产密钥隔离

状态：已修复（2026-08-15）

## 修复前证据与根因

部署手册要求在仓库根目录创建 `.env.production`，其中包含 100 个访问码、数据库口令、Cookie 签名密钥、稳定身份密钥、IP/ALTCHA HMAC 密钥以及真实模型 API Key；签发固定 IP 证书后，还会在 `deploy/certbot/conf/live/<IP>/privkey.pem` 产生 TLS 私钥。本地开发也可能残留被 Git 忽略的 `apps/api/prisma/dev.db` 及 journal/WAL，其中含项目和访客数据。原 `.dockerignore` 只排除了精确文件名 `.env`，没有覆盖另外两类秘密；原 `.gitignore` 也没有排除 Certbot 目录或 `dev.db` 的伴生文件。

API 与 Web Dockerfile 的 build stage 都执行 `COPY . .`。因此只要运维按手册把 `.env.production` 放在项目根再构建，它就会进入 Docker build context，并被写入中间构建层和 BuildKit 缓存。最终 runtime stage 没有显式复制该文件并不能消除远程缓存、旧 builder 或构建主机中间层的泄漏风险。

## 已实施的修复

根 `.dockerignore` 现在同时排除：

```dockerignore
.env
.env.*
**/.env
**/.env.*
!.env.example
!**/.env.example
deploy/certbot/
apps/api/prisma/dev.db*
```

规则覆盖根目录和工作区子目录的 `.env`/`.env.*`，只允许无秘密的 `.env.example` 进入上下文；包含证书、账户状态和 TLS 私钥的整个 Certbot 目录，以及 Prisma 本地数据库与 `-journal`/`-wal` 伴生文件都被排除。`.gitignore` 同步排除 `deploy/certbot/` 和 `apps/api/prisma/dev.db*`。Compose 通过 CLI `--env-file .env.production` 完成变量插值，再经 service `environment` 在运行时注入；Certbot 目录仅通过运行时 bind mount 提供。Dockerfile 不读取或复制这些生产秘密。

部署手册也明确要求：`.env.production` 只能作为 Compose 运行时输入，不能通过 `COPY`、`ARG` 或 `ENV` 烘焙到镜像。

## 可复核验收

在包含本地 `.env` 的源码副本上构建 build stage，然后直接检查构建容器：

```bash
docker build --target build -t idea2screenplay-secret-context-test -f apps/api/Dockerfile .
docker run --rm idea2screenplay-secret-context-test sh -c \
  'test ! -e /app/.env && test ! -e /app/.env.production && test -e /app/.env.example && test ! -e /app/deploy/certbot && test ! -e /app/apps/api/prisma/dev.db && test ! -e /app/apps/api/prisma/dev.db-wal'
```

验收标准：镜像构建成功，检查命令退出码为 0。Build stage 中 `/app/.env`、`/app/.env.production`、`/app/deploy/certbot` 和 `/app/apps/api/prisma/dev.db*` 必须不存在，`/app/.env.example` 必须存在。最终 runtime 使用白名单式 `COPY`，因此所有 `.env*`（包括 `.env.example`）、Certbot 目录和 `dev.db*` 都必须不存在。使用仅含假字符串的 `privkey.pem`、`dev.db`、`dev.db-wal` 哨兵验证两层，不读取或复制真实秘密。最终实测记录在本节末尾。

## 已经构建过旧镜像时

如果修复前曾在存在 `.env.production`、已签发的 `deploy/certbot/` 或本地 `apps/api/prisma/dev.db*` 的目录执行 Docker build，应按进入上下文的数据分别处置：

- 轮换数据库、模型、Cookie、身份、IP/ALTCHA 密钥和 100 个访问码；
- 对可能进入缓存的 TLS 私钥重新签发或替换证书，并按 CA/组织流程撤销旧证书；
- 把 `dev.db` 中的项目、访客和业务内容作为潜在数据泄漏进行事件响应，不能把删除本地文件当成“轮换”；
- 清理本机构建缓存、远程 cache、旧 build stage 与旧 runtime 镜像，并复核镜像仓库和 CI artifact。

清理缓存不能替代密钥轮换、证书替换或数据泄漏响应。

不要把 `.env.production` 提交到版本库，也不要把真实值贴进 Issue、CI 日志或本验收文档。

## 2026-08-14 至 2026-08-15 实测记录

在根目录确实存在非空 `.env` 的工作副本执行 API build-stage 构建：

- Docker Desktop Engine 29.5.3，构建成功；build context 传输量 **1.80 MB**，`COPY . .` 层重新执行。
- 临时镜像 ID：`sha256:4bf1daf790f3174364a1e65d1d01d152ea28a2eee4964f7157789f1b7308ce0f`，大小 **372,201,065 bytes**。
- 容器内断言 `! -e /app/.env`、`! -e /app/.env.production`、`-e /app/.env.example` 全部成立，命令输出 `ENV_CONTEXT_ISOLATION_OK`，退出码 0。
- 独立生产验收代理对另一份 build stage 重复环境文件检查，也得到 PASS；全程没有读取或输出任何密钥值。
- 最终冻结源码的 no-cache 生产镜像（测试时镜像摘要前缀 `sha256:d33880ff`）再次通过两层哨兵：build stage 输出 `build-stage-sensitive-file-check=PASS`，确认 `.env`/`.env.production`、`deploy/certbot`、`dev.db` 和 `dev.db-wal` 不存在而 `.env.example` 存在；runtime 输出 `runtime-sensitive-file-check=PASS`，确认包括 `.env.example` 在内的全部 `.env*`、TLS 目录和 dev.db/WAL 均不存在。
- 同一最终镜像的 `/proc/1` 与 `docker top` 都显示首进程为 `node apps/api/dist/main.js`，没有中间 `sh`。在本地假模型固定延迟 35 秒、Job/Run 已为 RUNNING、Project 已为 GENERATING 后发送 stop，`docker stop --timeout 120` 实际等待 **35,451.2 ms** 后容器自行退出；exit code 0、OOM=false，没有打满 timeout，也没有强杀。
- 假模型请求从 `04:32:21.492` 运行至 `04:32:56.496`，容器于 `04:32:56.951` 结束。数据库最终为 Job `SUCCEEDED/attempt=1`、Run `COMPLETED/providerCallCount=1`、Project `REVIEWING/PREMISE`、Version `STAGING/PREMISE`，唯一 ProviderCall 为 `success/retryable=false/httpStatus=200`，证明 SIGTERM 等待了在途结果提交。
- 验收创建的假 `privkey.pem`、`dev.db`、`dev.db-wal`、空 Certbot 目录、临时 Dockerfile/harness、17 个测试容器、9 个卷、9 个网络及所有 `ids-p1*` 临时镜像均已精确删除；复查测试资源和哨兵路径数量均为 0。公共基础镜像与 PostgreSQL 17 镜像保留。
