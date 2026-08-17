# Idea2Screenplay 会话交接文档

> **当前权威交接：2026-08-15（Asia/Shanghai）**  
> 项目路径：`D:\desktop\AI_ScriptTranfer\Idea2Screenplay-source`  
> 下面的“2026-08-15 P2 上线收口交接”是当前唯一执行基线；P1 最终记录及其后的收口过程与 2026-08-14 旧章节仅作历史背景，其中“仍未完成”“仍要重跑”“先修 120 秒队列延迟”“Token 未记录”“不要使用 Sub-Agent”等陈述已经过时，不得作为下一会话的执行优先级。

## 2026-08-15 P2 上线收口交接（当前基线）

用户在 P1 全部完成后要求继续。本轮已完成三个私测前高价值 P2，入口为 `docs/P2-INDEX.md`：

- `docs/P2-SSE-DATABASE-LOAD.md`：100 个不同 Job/100 条 SSE 的共享批量轮询。最终全部正常闭流，PostgreSQL 活跃窗口从旧版 301.735 commits/s 降至 **17.345 commits/s（-94.251%，约 17.396 倍）**，Job/Run/Project/Version/ProviderCall 一致性 100/100。
- `docs/P2-DATABASE-BACKUP-RESTORE.md`：三份 root-only、fail-closed Bash 脚本和 `docker-compose.restore.yml`。fresh PG17.10 实际 dump→restore，10 migrations、22 外键和核心计数一致，DB/API ready 通过；危险目标、缺确认、非空库和篡改文件均 exit 1。
- `docs/P2-CONTAINER-HARDENING.md`：API 非 root、只读根、CapEff 0、NoNewPrivs、PID/日志边界；Web/Postgres/Certbot 同步硬化。API 镜像列表大小 1.17GB→801MB，node_modules 646MB→342MB；fresh migration、Demo、Agent Skill、Web 及 SIGTERM 均实测通过。

当前开发数据库也已确认目标后应用 telemetry migration：migration **9→10**、Run **78→78**、历史 `providerCallCount=0` 为 78、新 ProviderCall 为 0，状态 up to date；临时逻辑备份验证可读后已删除。

最终独立回归：API **24 suites/205 tests**、Web **7 files/29 tests**；全仓 lint/build、Prisma validate、npm ls 均 exit 0；production、bootstrap、restore 三套 Compose config 均 exit 0。最终 no-cache SSE 镜像在 fresh PG17 应用 10 个 migration，负载后 ready 200、日志 ERROR/WARN 0。全部 P1/P2 测试资源已精确清理为 0；现有 dev/prod 容器和生产数据未被触碰，所有模型测试均为 Demo/loopback/本地假服务，0 付费调用。

下一步只剩目标服务器/供应商侧执行：生成正式 `.env.production` 与 100 个码；安装每日 root cron；每次发布前先备份；每月隔离恢复；设置供应商金额硬限额；在目标 VPS 采集 CPU/磁盘/连接数据后再决定 CPU 限额；另行进行 15–30 分钟长剧本真实质量测试。当前本机正在运行的 prod 容器没有被这轮代码替换，不能把本地源码完成误当成服务器已发布。

## 2026-08-15 P1 最终完成交接（下一会话从这里开始）

### 最终状态

用户要求的“解决全部 P1，并为每个 P1 在 docs 下写一份 md，且用实际测试数据证明”已经完成。总入口是 `docs/P1-INDEX.md`，六份详细交付为：

- `docs/P1-CONCURRENT-TRANSACTION-RETRY.md`
- `docs/P1-GENERATION-QUEUE-THROUGHPUT.md`
- `docs/P1-ACCESS-QUOTA-CONTROL.md`
- `docs/P1-HEALTH-VISITOR-LIFECYCLE.md`
- `docs/P1-LLM-RETRY-COST-TELEMETRY.md`
- `docs/P1-DOCKER-BUILD-SECRET-ISOLATION.md`

最终源码独立复跑：API **24 suites / 203 tests**、Web **7 files / 29 tests** 全部通过；全仓 lint、生产 build、Prisma validate 均通过；带安全占位环境变量的生产 Compose `config --quiet` exit 0。最终 no-cache API 镜像在 fresh PostgreSQL 17 上自动执行 10 个 migration 并通过 readiness。

### 最终生产镜像实际数据

全部模型测试使用 Demo、拒绝连接的 loopback 或本地假上游，没有连接真实供应商或生产数据库：

- **100 席位额度**：授权/建项目/challenge/生成授权/前 100 次入队全部成功，入队墙钟 1,398.8ms、p95 1,322.2ms，500/503 为 0；同 NAT 第 101 次先命中 IP 日额度并返回 429。IP real、100 条 visitor quota 合计、global day/month 均恰好 100；第 101 次没有额外 Job/Run/ProviderCall。
- **失败费用闭环**：拒绝连接的假上游使 100 个 Job 在 attempt 1 FAILED；Run FAILED、Project REVIEWING/IDEA、Version STAGING/IDEA、ProviderCall transport/retryable=false 均为 100，一致性 join 100/100，每 Run 恰好 1 次调用，没有自动付费重放。
- **队列 C=1/C=4**：20 项目均 20/20 SUCCEEDED；墙钟 19.035s / 4.115s，等待 p95 17.318s / 3.351s，峰值 RUNNING 1 / 4，最大相邻启动间隔 1.010s / 0.935s，25–35 秒阶梯均为 0；C=4 约快 4.63 倍。
- **100 并发阶段确认**：100×202，409/500/503 均为 0，墙钟 774.4ms、p95 720.8ms；随后 100 个 CHARACTERS Job 全部 SUCCEEDED/attempt=1。
- **健康与生命周期**：health 和 ready 各 100×200、Set-Cookie=0、AnonymousVisitor 1→1；真实 retention Job 为 completed，纯孤儿和无活动任务的过期项目被删，有未过期项目或 RUNNING/QUEUED Job 的访客/项目保留；主动删除在途返回 409，终态后返回 200 并实际级联删除。
- **失败残留修复**：Job GET、project active-job GET、SSE 均能把 `FAILED Job + RUNNING Run + GENERATING Project` 修为 Run FAILED、Project REVIEWING，事件序号不变；同项目已有新 QUEUED Job 时只修旧 Run，不回退新项目状态。
- **100 SSE**：100/100 为 200，建立 p95 106.7ms，持续 17.525s 后全部正常闭流；PG commit +5,288（约 302/s）、rollback 0、后端连接 6→22，API 约 0.27% CPU/148.6MiB，数据库约 4.29% CPU/81.61MiB。测试机稳定，但这是需监控的数据库读负载，不是低配 VPS 的无条件容量承诺。
- **PID 1 与停机**：`/proc/1`、`docker top` 均为 Node，无中间 shell。本地假模型固定 35 秒，在 Job/Run RUNNING 时 stop，容器等待 35,451.2ms 后自行 exit 0、OOM=false；数据库最终 Job SUCCEEDED、Run COMPLETED、Project REVIEWING/PREMISE、ProviderCall success=1，没有超时或强杀。
- **Docker 秘密**：最终 build stage 只含 `.env.example`，不含 `.env`/`.env.production`、Certbot/TLS、dev.db/WAL；runtime 连 `.env.example` 也不含。两层哨兵均 PASS。

验证结束后已精确删除本轮 17 个测试容器、9 个卷、9 个网络、全部 `ids-p1*` 临时镜像、临时 Dockerfile/harness、假 TLS/dev.db/WAL 哨兵与空目录；复查数量均为 0。公共基础镜像与 PostgreSQL 17 镜像保留。开发数据库和私有 `.env` 未被改写。

### 下一次真实上线前的运维动作

这些不是仍未修复的代码 P1：

1. 在可信终端生成 100 个访问码和彼此不同的随机生产密钥，写入服务器 `.env.production`；先运行 Compose `config --quiet`。公开 development 常量（含首尾空白变体）会在 production fail-closed。
2. 日/月配额限制的是完整流水线，不是 HTTP 调用、Token 或金额；供应商控制台仍必须设置金额告警/硬限额并与 `GenerationProviderCall` 对账。
3. 当前验收拓扑是单 API。多副本前要把访问票据、失败窗口和相关进程内状态迁移到共享存储并重新压测。
4. 100 人短剧工作流通过不等于 15–30 分钟剧本质量通过；长剧本还需独立的真实供应商质量、截断和成本测试。
5. pg-boss 无 delivery token 的极端长期数据库/心跳故障边界已经用 attempt fence、付费窗口与 expiry 下限降级为 FAILED/人工重试；上线应监控，不要删除这些防线。
6. 如果修复前曾在带 `.env.production`、Certbot 私钥或 `dev.db*` 的目录构建过镜像，必须轮换密钥/访问码、替换证书、清旧缓存/镜像，并按潜在数据泄漏处置 dev.db。

当前开发数据库的 telemetry migration 已于 2026-08-15 安全应用：确认目标为本机 `localhost:5433/idea2screenplay` 后，已完成迁移 9 → 10；Run 保持 78 → 78，历史 `providerCallCount=0` 为 78 条，新 ProviderCall 为 0 条，`prisma migrate status` 为 up to date。临时逻辑备份验证可读后已从容器精确删除。

### 延续授权与安全边界

用户已明确授权后续会话在本项目范围内直接进行代码/文档编辑、自动化测试、构建、隔离数据库和仅含假数据的 Docker 验收，不必反复确认。该授权不包括生产操作、付费模型调用、回显真实秘密、删除用户业务数据、清空 Docker 全局缓存或宽泛递归删除。根目录不是 Git 仓库；私有 `.env` 不得回显。

## 2026-08-15 P1 收口过程记录（已完成，仅作历史）

### 用户授权与执行方式

用户在 2026-08-15 明确要求：“先写一个 HANDOFF 文档，下次不用审批了，你直接干吧”。在平台实际授予的权限范围内，应把这句话理解为：继续当前 P1 收口时，可以直接进行项目内的只读检查、代码与文档编辑、单元/集成测试、构建、Docker 临时镜像、隔离 PostgreSQL 测试库、仅含假数据的哨兵文件，以及这些测试资源的精确清理；不要为这些常规、可恢复、任务内操作反复向用户确认。

这份文档不能覆盖系统或平台以后强制的审批机制，也不授权访问或修改生产环境、调用付费模型、回显/迁移真实密钥、删除用户业务数据、清空 Docker 全局缓存、执行宽泛递归删除或其他超出当前任务的破坏性操作。若平台确实弹出强制审批，只能遵守；若只是普通项目工作，直接完成并用实际测试结果交付。

当前目录不是 Git 仓库，不能依赖 `git status`、`git diff` 或 reset。已有文件属于用户；使用精确编辑并保留无关内容。根目录 `.env` 含非空秘密，禁止读取值、输出值或把值写进文档/日志。任何模型验收必须使用 `DEMO_MODE=true`，或使用虚假 Key 加不可达/本地假模型端点，绝不能连接真实供应商。

### 用户当前目标

用户最初要求用真实压测数据评估约 100 名少量用户上线风险，随后要求：“解决全部 P1，并且把每个 P1 解决后都写一个 md 文档，写在一个 docs 目录下”。因此完成条件不是“代码看起来合理”，而是：

1. 所有已经识别且实际可达的 P1 都有代码修复和回归测试；
2. 每个 P1 都有独立 `docs/P1-*.md`，含修复前证据、根因、修复、修复后实际数据和边界；
3. 最终冻结源码通过全量 test、lint、build、Prisma validate、Compose config；
4. 最终生产镜像在 fresh PostgreSQL 17 上完成额度、队列、100 人并发确认、健康/身份、PID 1/停机和秘密隔离验收；
5. 临时容器、卷、网络、镜像和假哨兵被精确清理；开发库和真实供应商不受影响。

### 已完成的 P1 修复

以下修复已经落盘，细节见对应文档：

- `docs/P1-CONCURRENT-TRANSACTION-RETRY.md`：Serializable P2034、Prisma P2010/SQLSTATE 40001/40P01 的 8 次退避重试，单槽 FIFO 有界闸门，创建、初次入队、真实额度、confirm、regenerate 统一复用；模型结果落盘只重试数据库事务。已有最终等价 PG17 实测：100 并发创建为 100×201，100 并发 Demo 入队为 100×202，0×500/503。
- `docs/P1-GENERATION-QUEUE-THROUGHPUT.md`：pg-boss notify 回退从 30 秒改为 1 秒，`burstWhenReadyExceeds=1`，`localConcurrency` 可配 1–10，新任务以 `projectId` 为 singleton key。生产 Compose 默认并发 2；先行 20 项目实测 20/20 SUCCEEDED、墙钟 9.072 秒、等待 p95 8.316 秒，无 30 秒阶梯。
- `docs/P1-ACCESS-QUOTA-CONTROL.md`：100 个席位访问码、生产 fail-closed、稳定 seat identity 与可轮换 session signer、CSRF 防护、共享 NAT 失败限流、100 人额度、前端 4xx 停轮询。已有实测：100 码授权 100×201，p95 110.4ms；同 NAT 创建 100×201，0×429/500/503，墙钟 781ms；密钥/访问码轮换均保持或撤销正确身份。
- `docs/P1-HEALTH-VISITOR-LIFECYCLE.md`：health/live/ready 绕过访客中间件，ready 检查 DB 与队列，`lastSeenAt` 五分钟节流，孤儿访客清理和活动 Job 项目保护。已有实测：health 与 ready 各 100×200、Set-Cookie=0、访客 1→1；同 Cookie 100 请求窗口内 `lastSeenAt` 精确不变；真实 pg-boss retention 闭环通过。
- `docs/P1-LLM-RETRY-COST-TELEMETRY.md`：只有明确 400/422 不支持 `response_format` 才兼容降级一次；其他供应商错误不自动重复付费；逐调用 `GenerationProviderCall` 与 Run 聚合遥测；输出校验/结果落盘失败不可重试；终态重投、防未知付费结果重投、失败状态二次落库旁路已修；生产生成模式 fail-closed。新增 migration `20260814193000_add_generation_provider_call_telemetry` 已在独立 PG17 空库部署并实写查询。
- `docs/P1-DOCKER-BUILD-SECRET-ISOLATION.md`：`.dockerignore`/`.gitignore` 排除 `.env*`、`deploy/certbot/` 和 `apps/api/prisma/dev.db*`，只允许 `.env.example`；API Docker CMD 已使用 `exec node`。旧冻结镜像上 `.env`、TLS privkey、dev.db/WAL 哨兵检查已通过，但最终新冻结镜像仍要重跑。

生产公开开发密钥拒绝也已加强：`COOKIE_SIGNING_KEY`、`VISITOR_IDENTITY_KEY`、`IP_HASH_KEY`、`ALTCHA_HMAC_KEY` 的已知开发值会在 production 拒绝启动。2026-08-15 最后一轮又把比较改为先 `trim()`，堵住尾空格绕过；代码已落盘，但这项最新改动还未完成最终全量回归。

### 最后中断时仍未完成的代码 P1

上一轮会话被中断时，三个代理都被系统标记为 interrupted。不要假设它们的未回报工作已经完成。只读核对显示：优雅停机预算和密钥 trim 已落盘；下面两项 Worker 修复尚未落盘，必须先完成。

1. **模型前置瞬时错误被重投防重逻辑误杀**

   当前 `apps/api/src/generation/generation.service.ts` 的 `executeStage()` 在 `project.update` 和 `stage:start emit` 之前就创建 `GenerationRun`。如果这两个模型调用前的数据库步骤发生瞬时错误，pg-boss 会把 Job 标为 RETRYING；第二次投递的 `stopPreviouslyAttemptedJob()` 只要看见同 version/stage 且 `startedAt >= queuedAt` 的任意 Run，就会按“可能已经付费”直接 FAILED，实际上上游调用次数为 0。

   推荐修复：把 `GenerationRun.create` 移到 `project.update` 与 `stage:start emit` 成功之后、真正 `generateStage()` 之前，尽量贴近供应商边界。Run 一旦创建仍保持费用优先的 unknown-outcome fail-safe；Run 创建前的纯数据库瞬时错误允许有限 Job 重试。补真实控制流测试：首次前置 update/emit 失败，第二次可继续且模型恰好调用一次；不能继续使用“mock executeStage 直接抛错且 findFirst 永远 null”的假覆盖。

2. **旧 RUNNING 快照可覆盖并发终态**

   `GenerationJobsService.get()`/`getActiveForProject()` 先读取业务 Job，再查询 pg-boss。若 Worker 已把业务 Job 原子提交为 SUCCEEDED，而查询方仍持有旧 RUNNING 对象，`reconcileQueueState()` 可能在看到 pg-boss completed 时通过无条件 `appendEvent` 把成功 Job 反写成 FAILED；`queued.state='retry'` 分支也可能把并发终态反写成 RETRYING。

   推荐修复：reconcile 在事务内重新读取当前 Job，若是 SUCCEEDED/FAILED 立即返回；只有仍为非终态时才能写失败事件或 RETRYING。两个分支都必须有终态保护。补 `get` 与 `getActiveForProject` 完成边界的竞态测试，证明旧快照不能覆盖 SUCCEEDED/FAILED。

### 已落盘但尚待验证的最新停机修复

Legacy 在明确拒绝 `response_format` 时可能串行执行两次、每次最多 300 秒的 HTTP 请求。旧公式只预算一次 timeout。当前源码已经改为：

```text
shutdown timeout = max(2 × LLM_TIMEOUT_MS, AGENT_TIMEOUT_MS) + 30s
docker-compose.prod.yml stop_grace_period = 645s
```

默认预算应为 210 秒，最大为 630 秒，Compose 留 15 秒容器余量。下一会话必须检查对应单元测试和两份文档是否已经同步，并使用本地延迟假模型做一次“任务正在执行时 docker stop”的无付费验收：Node 必须是 PID 1，SIGTERM 传到 Nest/pg-boss，任务收尾后容器自行退出且没有打满 stop timeout。

### 最终冻结后必须重跑的实测

`verify_access_final` 已准备过 harness，但因源码又发现 P1 而暂停。旧 quota 容器/卷曾被保留，不能把旧镜像数据当最终；优先重新创建 fresh DB，测试结束后精确清理。最终至少补齐：

1. **真实额度 100/101**：`DEMO_MODE=false`、虚假 Key、不可达 loopback 或本地假端点；100 个席位同 NAT 各创建项目并各预占一次完整生成流水线，前 100 次必须为 202，第 101 次必须为 429；核对 visitor/IP/global daily/monthly quota 精确为 100，证明没有外部调用。
2. **队列 C=1 与 C=4 对照**：各用 fresh PG17、20 个不同项目；记录入队状态、20/20 最终状态、墙钟、`queuedAt→startedAt` p50/p95/max、峰值 RUNNING、最大启动间隔、失败/重试数。C=4 必须观察到不同项目并行，同项目仍不得重叠，不能再有约 30 秒阶梯。
3. **100 人同时 confirm**：先让 100 个项目的 PREMISE Demo Job 成功，再同时确认进入下一阶段；目标 100×202、0×500/503，并核对下一阶段 Job/pg-boss 记录为 100。
4. **PID 1 与安全停机**：最终镜像 `docker top` 首进程必须是 Node；用本地延迟假模型制造在途任务后 stop，验证优雅退出。旧镜像的反例为 PID 1 是 `sh`，`docker stop --timeout 10` 实测 10.7 秒打满超时。
5. **构建上下文哨兵**：先确认目标假路径不存在，再用 `apply_patch` 创建只含假字符串的 `.env.production`（如确有用户文件则不要覆盖）、`deploy/certbot/conf/live/test/privkey.pem`、`apps/api/prisma/dev.db` 和 `dev.db-wal`；构建 build stage 与 runtime，断言 `.env*`/certbot/dev.db* 不存在而 `.env.example` 存在；最后用精确 `apply_patch` 删除测试创建的文件和空目录。绝不读取真实秘密。
6. **基础回归**：API/Web 全量测试、全仓 lint、全仓 build、`prisma validate`、带安全占位环境变量的生产 Compose `config --quiet`。最后一次干净基线（在上述最新 Worker 发现之前）为 API 24 suites/163 cases、Web 7 files/29 tests，lint/build 通过；最新修复后必须重新生成新数字。

把结果分别回填：

- 额度 100/101 → `docs/P1-ACCESS-QUOTA-CONTROL.md`，删除“最终数据会补”的占位；
- C=1/C=4 → `docs/P1-GENERATION-QUEUE-THROUGHPUT.md`，删除“正复测”的占位；
- 100 confirm → `docs/P1-CONCURRENT-TRANSACTION-RETRY.md`；
- Worker 重投、终态竞态、停机 → `docs/P1-LLM-RETRY-COST-TELEMETRY.md` 和队列文档；
- 最终哨兵与 PID 1 → `docs/P1-DOCKER-BUILD-SECRET-ISOLATION.md`。

最后运行：

```powershell
rg -n "待|会补|正以|最终数据|TODO" docs -g "P1-*.md"
```

不得让任何“已修复”文档仍以未来计划代替修复后证据。建议新增 `docs/P1-INDEX.md`，列出六个 P1 文档、最终状态、核心实测和上线前动作。

### 上线前必须明确告知用户的边界

- 当前开发数据库已于 2026-08-15 应用 telemetry migration；生产容器仍会在启动时自动 `prisma migrate deploy`。
- 如果修复前曾在含 `.env.production`、Certbot 私钥或 `dev.db*` 的目录构建过镜像，必须轮换全部相关密钥、重新签发/替换证书、清理旧镜像/构建缓存，并把 dev.db 内容按潜在数据泄漏处理。
- 项目级每日/月度额度限制的是完整生成流水线准入，不是模型 HTTP 调用、Token 或金额硬上限；供应商控制台仍需金额告警/硬限额。
- 100 人 5–8 分钟 Demo/已有真实模型样本不能证明 15–30 分钟长剧本质量；长时长仍需要单独真实质量验收，但不应在本次自动回归中产生付费调用。
- 100 个 SSE 连接的旧实测约 260 PostgreSQL tx/s，测试机仍稳定；它是后续容量优化项，不是本轮已经证实的上线阻断 P1。不要在没有新证据时把本轮范围扩张成重写推送架构。

### 下一会话最短执行顺序

1. 重新只读检查上述两个未落盘 Worker P1，直接实现并补测试；
2. 核对已落盘的双请求停机预算、密钥 trim 及其测试/文档；
3. 跑 API 定向测试，再跑全量 test/lint/build/validate/config；
4. 构建唯一最终镜像，依次跑 quota 100/101、C=1/C=4、100 confirm、PID1/在途 stop、secret sentinels；
5. 回填六份 P1 文档，新增总索引，做最后一次只读交叉审查；
6. 清理测试资源并向用户交付实际数字、文件链接和仍需运维完成的事项。

---

## 以下为 2026-08-14 及更早的历史交接

> 最后更新：2026-08-14（Asia/Shanghai）  
> 以下章节保留旧架构与测试背景，但其任务优先级已被上面的 2026-08-15 交接替代。

## 1. 给下一会话的直接指令

进入项目后先完整阅读本文件，以及根目录的 `PRODUCT.md`、`DESIGN.md`。如果任务涉及部署，再阅读 `docs/PRODUCTION_ARCHITECTURE.md` 和 `docs/IP_DEPLOYMENT.md`。

注意：当前目录**不是 Git 仓库**，没有 `.git`，所以不能依赖 `git status` 或 `git diff` 判断修改范围。不要覆盖用户文件，也不要假设可以回滚。

当前根目录已有私有 `.env`，内含 DeepSeek API Key。禁止在日志、回复、文档或补丁中回显该 Key，也不要复制到 `.env.example`。当前 `.env` 开启了 `LOCAL_UNLIMITED_MODE=true` 供本机持续测试；该开关不得进入生产，代码会在 `NODE_ENV=production` 时拒绝启动。

除非用户明确改变范围，下一步应先处理本文件第 10～11 节记录的 pg-boss 周期性唤醒延迟和 legacy Token 用量缺口，再继续 AgentRuntime 灰度验证与剩余阶段迁移。不要推翻已经确认的产品方向、两个 P0、安全生成版本、pg-boss 分阶段任务、人工确认和 7 天保留机制，也不要把参考 Agent 的通用危险工具搬进 Web 服务。

## 2. 已确认的产品方向

- 产品：把一句创意逐层发展成短剧/短视频剧本的 AI 编剧工作台，借鉴 Dramatron 的分层生成思想，但不复制其代码。
- 第一目标用户：短剧、短视频创作者。
- 第二版扩展：商业广告分镜剧本。
- 第一版目的：作为面试作品，让面试官通过一个网址直接查看成果。
- 登录策略：无需登录，使用匿名身份。
- 展示策略：混合演示——固定完整案例始终可看，每台设备每天最多真实生成 1 次。
- 视觉方向：独立电影编剧室；专业、克制、有文学感；纸张、墨色、场记板语言。
- 设计参考：`https://sitor.ai/`，只借鉴视觉节奏和高级感，不照搬。
- 技术栈：React + TypeScript + Vite；NestJS；Prisma + PostgreSQL。
- 主要访问地区：中国大陆。
- V1 部署：香港或境外轻量服务器、固定公网 IPv4、无需域名，通过 HTTPS IP 地址访问。
- 长期预算目标：V2 起固定基础设施尽量控制在人民币 200 元/年左右；模型调用费单独控制。

## 3. 当前已实现功能

- 面向用户的产品首页。
- 原创短剧、网文改编和热点启发三种创建模式。
- 热点选题台：来源状态、持久化观察快照、风险分级、来源追溯、AIScript 提示词预览和一键建立短剧项目。
- 固定完整示例：`/workspace/sample`，不依赖数据库或模型。
- 六阶段逐段生成：故事前提、人物、地点、节拍、分场、完整剧本；每阶段可编辑、保存、局部重生成并确认后继续。
- OpenAI-compatible Chat Completions 接口。
- DeepSeek V4 Flash 实际接入；支持通过 `LLM_THINKING_MODE` 显式关闭默认思考模式，稳定 legacy JSON 工作流。
- 可通过功能开关启用 PREMISE 阶段的受控 Agent 工具循环；默认关闭，不改变现有生成行为。
- 没有 API Key 时使用内置演示生成器。
- PostgreSQL 持久化项目、人物、地点、节拍、场景和生成记录。
- PostgreSQL + pg-boss 持久化生成任务，SSE 实时显示进度，断线时自动轮询恢复。
- 匿名项目固定保留 7 天；过期后所有访问立即返回 404，每天 03:00（Asia/Shanghai）由持久化清理任务删除。
- 人物、结构、场景和完整剧本工作台。
- 场景编辑、复制文本、下载 Fountain。
- React 响应式界面。
- Docker 本地 PostgreSQL、生产 API/Web/PostgreSQL/Caddy 配置。
- 固定公网 IP + Certbot 短期 IP 证书部署文档。
- Windows 一键启动入口 `start-dev.cmd` / `start-dev.ps1`，可自动启动 Docker Desktop、数据库、迁移、API、Web 和浏览器。
- 仅限非生产环境的 `LOCAL_UNLIMITED_MODE`，供本机全量测试时绕过项目数、局部重生成次数、挑战频率及访客/IP/全站额度。

## 4. 已完成的 P0：匿名项目所有权隔离

实现位置：

- `apps/api/src/security/visitor.middleware.ts`
- `apps/api/src/security/visitor-request.ts`
- `apps/api/src/security/security.module.ts`
- `apps/api/src/projects/projects.controller.ts`
- `apps/api/src/projects/projects.service.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260808030000_add_anonymous_ownership_and_quotas/migration.sql`

当前行为：

- 首次请求生成 256-bit 随机匿名令牌。
- Cookie 名为 `ids_visitor`，带签名，设置 `HttpOnly`、`SameSite=Lax`、`Path=/`。
- 生产环境设置 `Secure=true`。
- 数据库只保存令牌 HMAC，不保存 Cookie 原文。
- 所有项目列表、读取、更新、场景编辑、删除和生成接口都绑定 `visitorId`。
- 跨访客读取、删除和获取生成挑战统一返回 404。
- 旧数据库项目在迁移时归到不可通过浏览器获得的 `legacy-mvp-owner`，不会暴露给新访客。
- 每位匿名访客最多保留 5 个项目。
- 每 IP 每天最多创建 20 个项目，减少通过清 Cookie 滥用数据库的风险。

前端的普通 `fetch` 和 `EventSource` 都已显式携带 Cookie，因此开发环境跨端口也能保持同一匿名身份。

## 5. 已完成的 P0：防刷与模型成本保护

实现位置：

- `apps/api/src/security/abuse-protection.service.ts`
- `apps/api/src/security/dto/authorize-generation.dto.ts`
- `apps/api/src/generation/generation.controller.ts`
- `apps/api/src/generation/generation.service.ts`
- `apps/api/src/generation/llm.service.ts`
- `apps/web/src/api.ts`
- `apps/web/src/App.tsx`

生成流程现在是：

```text
获取绑定项目和访客的 ALTCHA 挑战
→ 浏览器完成 PBKDF2 工作量证明
→ 服务端验证并签发 2 分钟一次性票据
→ POST 创建 GenerationJob 并消费票据
→ 默认模式在 PostgreSQL 事务中原子预占访客/IP/全站额度并写业务任务与 pg-boss 任务；本地无限模式仅跳过额度预占
→ Worker 获取全局生成槽位
→ 才允许调用模型
```

默认限制：

| 限制 | 默认值 |
|---|---:|
| 每访客最多保留项目 | 5 |
| 每 IP 每天创建项目 | 20 |
| 每访客每天真实生成 | 1 |
| 每 IP 每天真实生成 | 3 |
| 全站每天真实生成 | 8 |
| 全站每月真实生成 | 100 |
| 同时生成任务 | 1 |
| 每 10 分钟 ALTCHA 挑战 | 20 |
| 单次模型输出 Tokens | 4096，配置最高不超过 8192 |

补充说明：

- 真实生成额度保存在 PostgreSQL，服务重启后仍有效。
- ALTCHA 已用挑战、一次性票据和短时挑战频率窗口目前保存在进程内存中；重启会使未消费票据失效，但数据库额度仍能阻止实际模型滥用。
- 演示生成器不消耗“每天 1 次真实生成”额度，但仍经过项目所有权、ALTCHA 和全局并发保护。
- IP 只以按日期加盐的 HMAC 形式入库，不保存原始 IP。
- 每月上限是按真实生成启动次数实施的硬熔断，与 Token 上限组合后形成可预测的最大调用边界，不是精确人民币账单。
- `LOCAL_UNLIMITED_MODE=true` 时，仅在非生产环境绕过项目数、局部重生成次数、挑战频率及所有持久化额度；匿名所有权、ALTCHA 一次性票据、pg-boss 持久化任务和并发保护仍然生效。
- 生产环境若检测到 `LOCAL_UNLIMITED_MODE=true` 会拒绝启动，不能把本地测试开关当作生产配置。

## 6. 数据模型增量

P0 新增：

- `AnonymousVisitor`
- `DailyVisitorQuota`
- `DailyIpQuota`
- `GlobalDailyGenerationQuota`
- `GlobalMonthlyGenerationQuota`
- `Project.visitorId`

P1 生成版本新增：

- `GenerationVersion`：在六阶段生成期间持久化暂存结果，状态为 `STAGING`、`ACTIVE`、`SUPERSEDED` 或 `FAILED`。
- `Project.activeVersionId`：成功提交时与当前人物、地点、节拍、场景投影在同一个事务中切换。
- `GenerationRun.versionId`：把每个阶段的运行记录绑定到对应版本。

P1 持久化任务新增：

- `GenerationJob`：保存 `QUEUED`、`RUNNING`、`RETRYING`、`SUCCEEDED`、`FAILED` 状态、进度、安全错误、尝试次数和结果版本。
- `GenerationJobEvent`：按任务保存有序进度事件，为 SSE 重连回放和轮询兜底提供事实来源。
- `GenerationVersion.jobId` / `GenerationJob.resultVersionId`：把业务任务、暂存版本和最终激活版本连成可追溯链路。
- pg-boss 使用同一个 PostgreSQL，任务创建与真实生成额度预占位于同一个 `Serializable` 事务，避免“扣额度但未入队”或“入队但无业务任务”。
- 每个项目同时最多一个活跃业务任务，数据库使用条件唯一索引兜底。

P1 分阶段与保留策略新增：

- `GenerationVersion.currentStage` / `confirmedStage`：记录草稿当前阶段和最后确认阶段。
- `GenerationJob.versionId` / `stage`：一个业务 Job 只执行一个阶段；后续基础阶段不重复消耗每日真实生成额度。
- `Project.regenerationsUsed`：项目级局部重生成计数，默认最多 3 次。
- `Project.expiresAt`：创建时固定为当前时间加 7 天，不因访问或编辑顺延。
- pg-boss `expired-project-cleanup`：每天 03:00 按 `Asia/Shanghai` 时区执行级联清理。

热点监听新增：

- `TrendTopic`：列表级公开信号、来源、风险、机会分和最后出现时间。
- `TrendObservation`：排名、热度、动量与观测时间历史。
- `Project.trendTopicId` / `ProjectMode.TREND_INSPIRED`：项目来源追溯和生成安全分支。

当前共 9 个迁移。前 7 个迁移已在全新 PostgreSQL 18 临时集群中按顺序真实执行，并通过完整分阶段任务与过期清理黑盒验证；2026-08-14 已把热点迁移 `20260814090000_add_trend_topics` 和索引迁移 `20260814103000_optimize_trend_observation_indexes` 部署到当前 PostgreSQL 17 开发库。10 部真实测试项目及其 60 条 Job/Run 数据仍保留在开发库中。

## 7. 环境变量

完整示例见 `.env.example`。生产环境必须配置至少 32 字符的不同随机密钥：

```dotenv
COOKIE_SIGNING_KEY=<random-secret>
IP_HASH_KEY=<different-random-secret>
ALTCHA_HMAC_KEY=<different-random-secret>
```

生产环境缺少或使用过短密钥时，NestJS 会拒绝启动。

当前本地模型配置（API Key 仅保存在私有 `.env`，不得回显）：

```dotenv
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-v4-flash
LLM_THINKING_MODE=disabled
LLM_MAX_OUTPUT_TOKENS=4096
DEMO_MODE=false
GENERATION_RUNTIME=legacy
```

DeepSeek V4 默认启用 thinking；legacy 路径需要结构化 JSON，因此本地显式设置 `LLM_THINKING_MODE=disabled`。此变量是可选的供应商兼容开关，未设置时不会向其他 OpenAI-compatible 服务发送 `thinking` 字段。

重要额度变量：

```dotenv
VISITOR_PROJECT_LIMIT=5
IP_PROJECTS_PER_DAY=20
VISITOR_GENERATIONS_PER_DAY=1
IP_GENERATIONS_PER_DAY=3
GLOBAL_GENERATIONS_PER_DAY=8
GLOBAL_GENERATIONS_PER_MONTH=100
GENERATION_CONCURRENCY=1
ALTCHA_COST=1000
ALTCHA_CHALLENGES_PER_10_MINUTES=20
LLM_MAX_OUTPUT_TOKENS=4096
JOB_RETRY_LIMIT=2
JOB_EXPIRE_SECONDS=900
PROJECT_REGENERATIONS_MAX=3
```

本地无限测试开关：

```dotenv
LOCAL_UNLIMITED_MODE=false
```

- `.env.example` 默认必须保持 `false`；当前私有 `.env` 为满足用户本机全量测试而设为 `true`。
- 开启后不读取或递增项目数、局部重生成次数、挑战频率、访客/IP/全站日月额度，但仍保留匿名隔离、ALTCHA、持久化队列和并发限制。
- `NODE_ENV=production` 时开启该变量会导致 NestJS 拒绝启动。

Agent 灰度变量：

```dotenv
GENERATION_RUNTIME=legacy
AGENT_ENABLED_STAGES=PREMISE
AGENT_PREMISE_MAX_STEPS=4
AGENT_PREMISE_TOKEN_BUDGET=16000
AGENT_TIMEOUT_MS=90000
```

默认必须保持 `GENERATION_RUNTIME=legacy`。只有真实供应商 tool-call 烟雾测试和依赖升级验证通过后，才切换为 `agent`。

生产 Compose 已要求三项密钥，并自动启用安全 Cookie。

热点监听变量见 `.env.example` 与 `docs/TREND_MONITORING.md`。默认只启用无需 Key 的 Wikimedia 中文站每日热门弱信号；可选官方来源为百度千帆 `GET /v2/tools/baidu_trending`、微博商业热搜榜、X API v2 WOEID 趋势和 YouTube Data API v3 `mostPopular`。所有来源无凭证时自动关闭；微博、X、YouTube另有用途批准开关。已于 2026-06-18 下架的百度 `trending_lists` 不得恢复。后台每 5 分钟检查一次，各来源独立 TTL（微博 5 分钟、X 30 分钟、YouTube 1 小时、其他默认 2 小时），stale 为 6 小时、一般观察记录保留 14 天。

## 8. 本地启动

当前根目录已有私有 `.env`。Windows 推荐直接双击：

```text
start-dev.cmd
```

它会调用 `start-dev.ps1`，检查 Node/npm/Docker，必要时启动 Docker Desktop，创建缺失的 `.env`（不会覆盖已有文件），按需安装依赖，启动并等待 PostgreSQL，执行 Prisma generate/migrate，同时启动 API 与 Web，并在就绪后打开浏览器。脚本已通过 PowerShell 与 Windows PowerShell 语法检查。

也可以手动运行：

```powershell
# 仅在 .env 不存在时执行：Copy-Item .env.example .env
docker compose up -d postgres
npm run db:generate
npm run db:migrate
npm run dev
```

访问：

- Web：`http://localhost:5173`
- API 健康检查：`http://localhost:3000/api/health`

停止：

```powershell
# 先在开发服务终端按 Ctrl+C
docker compose stop postgres
```

截至 2026-08-11 本次更新时，Web `5173`、API `3000` 与 PostgreSQL `5433` 均在运行，API 健康检查返回 `generationMode=llm`、`model=deepseek-v4-flash`。运行态是临时状态，下一会话仍应先检查端口和健康接口，不要仅依赖本文描述。

## 9. 已完成验证

最后一次完整验证结果：

- `npm run lint`：通过。
- `npm run test`：通过；最新全量回归为 API 21 个套件/97 项测试、Web 5 个文件/16 项测试。
- `npm run build`：API 和 Web 均通过。
- `prisma validate`：通过。
- `prisma migrate deploy`：全新 PostgreSQL 18 临时集群中 6 个迁移全部成功。
- `prisma migrate status`：同一临时集群中 schema 为最新。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：当前报告 4 个低危漏洞，来自为 AgentRuntime 引入的参考版本 `ai@5.0.98` / `@ai-sdk/openai@2.0.44` 及其 `@ai-sdk/provider-utils` 依赖，公告为 `GHSA-866g-f22w-33x8`。自动修复会升级到不兼容大版本，禁止直接执行 `npm audit fix --force`；应先升级 SDK、修正 API 差异并重新跑工具调用测试。
- 当前 `npm run build` 生产构建通过；Docker 引擎正在运行，但本轮未重新执行生产 API/Web 镜像构建，部署前仍需复核 `docker compose -f docker-compose.prod.yml build`。

本地无限模式回归测试覆盖：

- 非生产环境显式开启后，项目创建和真实生成事务不会读取或递增持久化额度表。
- 本地无限模式仍通过已绑定访客与项目的 ALTCHA 一次性票据进入业务事务。
- 局部重生成不再受项目次数限制。
- `NODE_ENV=production` 与 `LOCAL_UNLIMITED_MODE=true` 同时出现时，服务拒绝启动。

2026-08-11 DeepSeek V4 Flash 真实端到端测试：

- DeepSeek `/models` 凭据预检返回 200，确认 `deepseek-v4-flash` 可用；没有在日志或报告中保存 Key。
- 使用 `DEMO_MODE=false`、`GENERATION_RUNTIME=legacy`、`LLM_THINKING_MODE=disabled`，顺序生成 10 部不同题材的 5 分钟中文短剧。
- 10/10 项目最终为 `READY / COMPLETE`；60/60 个阶段 Job 为 `SUCCEEDED`，所有 Job 均第一次尝试成功，无安全错误或失败 Run。
- 共生成 70 场戏、12,251 个剧本文字；平均每部 7 场、1,225 字，范围为 957～1,676 字。
- 总耗时 769.1 秒，平均 76.9 秒，中位数 43.8 秒；10 个 Fountain 均有标题、场景标题且无 TODO/TBD/`undefined`/`null` 占位符。
- 测试自动化脚本：`scripts/test-10-screenplays.mjs`。
- 结果报告：`test-results/deepseek-v4-flash-2026-08-11T03-26-02-882Z/REPORT.md`；同目录保留 10 个 Fountain 与 10 个完整项目 JSON。
- 自动化使用独立匿名 Cookie，因此这些数据库项目不会出现在用户现有浏览器会话的项目列表中；这是所有权隔离的预期行为。
- 测试在额度表中留下 2026-08-11 日/月各 10 次使用记录；当前本地无限模式会忽略这些记录，关闭该模式后默认额度将再次生效。
- 第 3、6、9 个项目的首个 `PREMISE` Job 均在 `QUEUED` 状态等待约 120 秒，阶段总耗时分别为 124.6、124.7、126.0 秒；随后所有阶段恢复正常。该规律稳定复现，尚未修复。
- Legacy 路径的 60 条 `GenerationRun` 中，`promptTokens` / `completionTokens` 均为空；因此当前无法从数据库还原精确 Token 与费用。

新增生成版本回归测试覆盖：

- 已有成功稿时，后续阶段失败不会调用人物、地点、节拍或场景删除。
- 阶段失败后保留已确认阶段和当前活动稿，暂存版本可从失败阶段继续重试。
- 完整剧本最终确认前不会删除或替换当前稿。
- 最终确认后，当前稿投影和 `activeVersionId` 在同一个事务中切换。

新增持久化任务回归测试覆盖：

- 业务 `GenerationJob` 与 pg-boss 任务在票据/额度事务内一起创建。
- 跨访客查询 Job ID 返回 404。
- SSE 可从 `Last-Event-ID` 之后回放数据库事件，并在终态关闭。
- 成功业务任务、结果版本与项目激活在同一个提交事务中完成。
- 前端卸载/路由切换会关闭 EventSource；SSE 断线或消息解析异常会切换到 Job 状态轮询，不会误报生成失败。

新增 AgentRuntime 回归测试覆盖：

- Run-scoped ToolRegistry 拒绝白名单外工具，不能注册 `bash` 等通用能力。
- Agent 只有调用受控提交工具后才能成功结束。
- Token 超限会终止运行；连续三次相同工具调用会触发循环检测。
- 默认配置下 Agent 路径关闭，原有 legacy JSON 生成行为不变。
- PREMISE Skill 能从构建产物加载，合法草稿只能经 `submit_premise_draft` 提交。
- Agent 成功时 `promptTokens` 和 `completionTokens` 回写现有 `GenerationRun`。

真实 PostgreSQL + pg-boss 黑盒结果：

- 完整走通创建项目、ALTCHA、授权、六个独立阶段 Job、每阶段确认、版本激活和刷新式状态查询。
- 六个 Job 均观察到持久化终态，共写入 6 条 `GenerationRun`；只有首个阶段消费一次生成票据。
- 在故事前提和完整剧本阶段写入人工编辑标记，后续阶段与最终活动稿均完整保留。
- 最终确认前当前投影保持不变；确认后项目为 `READY / COMPLETE`、生成 6 个场景且无活跃任务。
- 项目创建时间与 `expiresAt` 精确相差 7 天；到期后 API 立即返回 404。
- `expired-project-cleanup` 定时配置为 `0 3 * * * / Asia/Shanghai`，真实队列任务成功级联删除过期项目。

真实黑盒测试使用两个独立 Cookie 会话，结果：

- 所有者能看到自己的项目。
- 另一个访客项目数为 0。
- 跨访客读取项目：404。
- 跨访客删除项目：404。
- 跨访客获取 ALTCHA 生成挑战：404。
- 第一次真实生成成功预占额度。
- 同一访客第二次真实生成在任何模型调用前被“每天只能真实生成 1 次”拦截。
- Cookie 响应包含 `HttpOnly`。

旧的隔离黑盒临时集群和临时脚本已清理。2026-08-14 热点验收结束后已停止本轮启动的 API/Web 开发进程，并删除四个 `.tmp-trend-*` QA 日志；PostgreSQL 容器和 10 部 DeepSeek 测试数据、正式测试脚本/报告有意保留。

## 10. 代码审查状态

### 已完成的 P1：重新生成失败不再丢失旧稿

实现位置：

- `apps/api/src/generation/generation.service.ts`
- `apps/api/src/generation/generation.service.spec.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20260808050000_add_generation_versions/migration.sql`

当前行为：

- 重新生成开始前会把当前可见稿保存为不可变版本，包含用户已经修改的场景内容。
- 六个模型阶段只写新的 `STAGING` 版本，不再提前清空项目当前成果。
- 完整剧本最终确认后，才在一个 PostgreSQL `Serializable` 事务中替换当前投影并切换 `activeVersionId`。
- 任一阶段失败时，旧人物、地点、节拍、场景和剧本文本保持不变；暂存版本保留已确认内容并允许重试。
- 原当前版本只在成功切换后标记为 `SUPERSEDED`，阶段运行记录通过 `versionId` 可追溯。

### 已完成的 P1：PostgreSQL 持久化生成任务

实现位置：

- `apps/api/src/generation/generation-queue.service.ts`
- `apps/api/src/generation/generation-jobs.service.ts`
- `apps/api/src/generation/generation-job-owner.guard.ts`
- `apps/api/src/generation/generation.controller.ts`
- `apps/api/prisma/migrations/20260808070000_add_generation_jobs/migration.sql`
- `apps/web/src/hooks/useGenerationJob.ts`
- `apps/web/src/App.tsx`

当前行为：

- API 接受生成后立即返回持久化 Job ID；业务任务和 pg-boss 任务共用 PostgreSQL。
- Worker 使用 pg-boss 的数据库队列、心跳、过期和有限指数退避重试；服务重启后队列任务不会只存在于 Node 内存。
- Job 状态和阶段进度事件按序持久化；SSE 支持事件序号回放，断开后前端自动轮询 `GET /api/jobs/:jobId`。
- 页面刷新后会查询项目当前活跃任务并恢复观察；路由切换和卸载会关闭旧连接/定时器。
- 客户端只收到安全、稳定的错误文案；详细异常仅保留在服务端日志和失败运行记录中。
- 每阶段 Job 终态与暂存结果原子提交；最终确认时版本激活与当前稿投影原子提交，失败或重试不覆盖已有成功稿。

### 已完成的 P1：六阶段逐段编辑与确认

- 一个 `GenerationJob` 只生成一个阶段，首阶段仍经过 ALTCHA、票据和额度事务；确认后创建下一阶段 Job，不重复扣每日额度。
- 新增阶段保存、局部重生成和确认接口；只能编辑当前未确认阶段，确认后历史阶段只读。
- 最终 `SCRIPT` 确认才激活暂存版本；项目级局部重生成默认最多 3 次。
- 工作台提供六阶段进度条、各阶段专用编辑器、保存/重写/确认动作、刷新恢复和失败重试。

### 已完成的 P1：匿名项目固定保留 7 天

- 项目创建时原子写入固定 `expiresAt`，列表、详情、更新、场景、生成、Job 和所有权检查统一排除过期项目。
- 过期项目不再占用“最多保留 5 个项目”的存量限制。
- pg-boss 每天 03:00（Asia/Shanghai）执行清理；删除项目时由外键级联清理版本、运行、业务 Job 和事件。
- 侧栏显示剩余保留天数；真实数据库已验证到期不可访问与清理删除。

### AgentRuntime 第一条纵向切片

参考 `D:\Agent\tcf_AIlesson\AAA__agent` 的 Agent Loop、ToolRegistry 和 Skill 思路完成了第一条安全纵向切片，但没有搬运其 CLI、飞书、本地 Session/Memory、Bash、文件工具、MCP、Cron 或 Sub-Agent。

当前实现：

- `apps/api/src/agent/runtime/`：AI SDK 模型适配器和有步数、Token、超时、重复调用检测的循环。
- `apps/api/src/agent/tools/`：每次 Run 独立创建、使用不可变白名单的 ToolRegistry。
- `apps/api/src/agent/skills/premise/SKILL.md`：显式加载的 PREMISE Skill，构建时复制到 `dist`。
- `apps/api/src/agent/validators/premise.schema.ts`：PREMISE 的 Zod 深层结构校验。
- `apps/api/src/agent/premise-agent.service.ts`：只注册 `validate_premise_draft` 和 `submit_premise_draft`，提交结果仍交由现有 Serializable 事务写入 STAGING Version。
- `GenerationRun.promptTokens/completionTokens` 会记录 Agent 用量；Job、版本、SSE、人工确认和最终激活逻辑没有改变。

本轮新增依赖：

- `ai@5.0.98`
- `@ai-sdk/openai@2.0.44`
- `zod@3.25.76`

本轮没有新增 Prisma 表或迁移。Agent 运行仍复用 `GenerationRun`，步骤数和工具明细暂未单独持久化。

必须保持的架构边界：

```text
GenerationJobsService / pg-boss
→ GenerationService 创建现有 GenerationRun
→ 仅在 PREMISE 且功能开关开启时调用 PremiseAgentService
→ AgentRuntime 运行独立 Skill 和 Run-scoped 工具
→ submit_premise_draft 只返回经过 Zod 校验的内存结果
→ GenerationService 在原有 Serializable 事务中更新 STAGING Version、Run 和 Job
→ 人工确认后才创建下一阶段 Job
→ SCRIPT 人工确认后才激活 ACTIVE Version
```

以下能力明确没有迁移，也不得在生产 Web 模式注册：

- Bash、任意文件读写和项目外路径访问；
- MCP、Cron、插件、飞书和任意外部 API；
- 本地 Session/Memory；
- 动态 `tool_search`；
- Sub-Agent 或并行写工具；
- Agent 直接访问 Prisma 或自行激活正式版本。

启用条件：

```dotenv
DEMO_MODE=false
GENERATION_RUNTIME=agent
AGENT_ENABLED_STAGES=PREMISE
```

默认 `GENERATION_RUNTIME=legacy`；即使配置为 Agent，演示模式或缺少 API Key 时也不会进入 Agent 路径。DeepSeek V4 的 legacy JSON 生成已经真实验证，但当前尚未通过项目内 AgentRuntime 完成真实 tool-call 兼容性烟雾测试。生产启用 Agent 前仍必须验证多轮工具调用、JSON Schema 参数，以及 DeepSeek thinking/reasoning 字段在 AI SDK 适配器中的行为。

真实模型烟雾测试至少需要验证：

1. 模型能读取 PREMISE 上下文并产生合法 tool call；
2. `validate_premise_draft` 的 tool result 能回传到下一轮；
3. 模型最终调用 `submit_premise_draft`，而不是只输出自由文本；
4. `parallelToolCalls=false` 生效，不会重复写入；
5. 超时、无工具调用、Schema 错误和供应商 4xx/5xx 能进入预期失败路径；
6. `GenerationRun` Token 用量能够写入，Job 仍产生安全错误和持久化终态。

### 2026-08-11：DeepSeek V4 与本地无限测试模式

实现位置：

- `apps/api/src/generation/llm.service.ts`
- `apps/api/src/generation/llm.service.spec.ts`
- `apps/api/src/security/abuse-protection.service.ts`
- `apps/api/src/security/abuse-protection.service.spec.ts`
- `apps/api/src/generation/generation-jobs.service.ts`
- `.env.example`
- `README.md`

当前行为：

- `LLM_THINKING_MODE` 只有值为 `enabled` 或 `disabled` 时才向 Chat Completions 请求加入 `thinking: { type }`，因此不会无条件污染其他兼容供应商请求。
- 当前本地使用 DeepSeek 官方 `https://api.deepseek.com` 与 `deepseek-v4-flash`，legacy JSON 路径显式关闭 thinking。
- `LOCAL_UNLIMITED_MODE=true` 只在非生产环境生效，绕过项目数、局部重生成次数、挑战频率和所有真实生成额度。
- 无限模式不会绕过访客/项目所有权、ALTCHA 证明与一次性票据、每项目单活跃 Job 唯一约束、pg-boss 持久化和 `GENERATION_CONCURRENCY`。
- 生产环境检测到无限模式会抛错并拒绝启动。
- 当前私有 `.env` 已开启无限模式；`.env.example` 保持关闭。

### 2026-08-14：热点选题台与安全转译

实现位置：

- `apps/api/src/trends/`：Wikimedia、当前百度热搜、微博商业热搜、X 地区趋势、YouTube 热门娱乐发现源、授权 JSON Feed、快照、风险策略和提示词编译。
- `apps/api/prisma/migrations/20260814090000_add_trend_topics/migration.sql`。
- `apps/api/prisma/migrations/20260814103000_optimize_trend_observation_indexes/migration.sql`。
- `apps/web/src/components/TrendRadar.tsx`：热点台、筛选、来源状态、风险标签和提示词侧页。
- `apps/web/src/components/CreateProjectModal.tsx` / `Studio.tsx`：热点项目建档与来源追溯。
- `docs/TREND_MONITORING.md`：截至 2026-08-14 的外部来源、成本、权限和合规调研。

关键边界：

- 旧千帆 `trending_lists/medium` 已完全移除；可选付费源只调用当前 `baidu_trending?tab=...`。
- 千帆所有实际 HTTP 请求（跨 tab 与同 tab 重试）共用节流队列并留出至少 1.1 秒，遵守官方 1 QPS；每个 tab 独立保留最近成功快照，部分失败会标记 `degraded` 而不会清空旧数据。
- `brief.prompt` 与项目 `sourceText` 不包含原始标题、摘要、URL 或现实实体；这些只在 UI 供人工核对。
- 类别和社会张力只从服务端白名单产生；同类别不同热点可得到不同的安全冲突轮廓，外部恶意类别不能进入 Prompt。
- 未成年人、隐私和人肉信息在入库前即脱敏并阻断；指控、灾难、政治、公共卫生等标记为 `REVIEW`。
- 只有 `LOW` 热点可建立项目；`REVIEW` 只允许查看 Brief。项目创建、阶段入队、Worker 执行、结果提交和最终激活都会重查当前风险，后续升级为 REVIEW/BLOCKED 的热点不能继续生成。
- 六个生成阶段与 PREMISE Agent Skill 都重复注入虚构边界：合成人物、虚构时空、至少四轴变换、禁止真人姓名/原话/机构指控。
- 抓取失败不阻断公开 API；列表首屏不会等待慢速第三方请求；每个来源返回 `lastSuccessAt/stale/degraded` 并展示最后一次成功快照。
- 每个逻辑来源及其 tab/WOEID/region 独立判断 DB 新鲜度；新启用来源不会被其他来源的最新快照压住。成功空榜使用进程内 `lastSuccessAt` 遵守 TTL，不会被每次列表访问反复触发。
- 来源异常或部分地区降级采用进程内指数退避，默认 5 分钟起、连续失败最高 1 小时；公开列表和手动刷新均不能绕过。多副本前仍需把 `nextRetryAt`/失败计数放入共享存储。
- 微博只在商业合同确认开关为 true 时启用，优先使用官方 `source=<AppKey>` 合同/IP授权方式；OAuth Token 仅作需轮换的回退。`id=0` 置顶项、博文、账号和评论均不入库。
- X 只请求趋势名和公开计数，读取 `x-rate-limit-reset` 且不在 429 窗口内重试；YouTube 只请求 ID、标题、categoryId 和 viewCount。两类海外发现源因无可靠语言码统一标为 REVIEW，当前不能直接建立短剧项目。
- YouTube API 数据在最多 28 天后删除；若 Topic 被项目引用，只保留无原始 ID/标题/链接/计数/派生分数的应用占位记录，以继续执行风险门禁。
- 跨源热度先在各来源内按排名/浏览量相对位置归一化；观察记录清理由独立定时任务执行，公开刷新限流表有硬上限。
- 当前生产拓扑只有一个 API 实例。扩成多副本前必须增加分布式刷新租约，避免竞态放大付费调用。
- `.gitignore` 已覆盖 `.env.*` 并单独放行 `.env.example`；X/微博/YouTube 凭证不得提交，生产使用 Secret Manager/Docker secret，查询参数必须在 APM/代理/出口日志中脱敏。

本轮验证：Prisma generate/validate/migrate 成功，当前开发库 9 个迁移全部应用；最新全量回归为 API 21 个套件 97 项测试、Web 5 个文件 16 项测试；前后端 lint、生产构建与生产 Compose 配置校验通过。黑盒验证确认 LOW Brief/项目创建均为 2xx、服务端覆盖客户端篡改的 Prompt、原始标题/摘要/URL 不进入 `sourceText`、REVIEW 项目创建返回 400；验证项目与 Topic 已清理。

### P2

- pg-boss 在 10 项目顺序测试中稳定出现“每第 3 个新项目的首个 PREMISE Job 等待约 120 秒”现象；需要最小复现并检查 `useListenNotify`、Worker 轮询、连接池 `max: 3` 与事务内 `boss.send` 的组合。
- Legacy `LlmService` 没有解析供应商 `usage`，60 条真实 `GenerationRun` 的 `promptTokens` / `completionTokens` 为空；需要补齐用量持久化和可审计成本报告。
- Legacy 路径和其余五阶段仍只做浅层字段/数组检查；PREMISE Agent 路径已使用 Zod，需要继续迁移 CHARACTERS 到 SCRIPT。
- `generateJson` 对所有错误都可能再调用一次模型，需要错误分类和有限重试。
- Caddy 缺少 CSP、`frame-ancestors` 和 `X-Frame-Options`。
- 热点刷新只有进程内单航班和数据库新鲜度检查；多 API 副本需要数据库/Redis 分布式锁与按来源预算熔断。
- 热点风险目前是确定性规则，生成输出还没有单独的真人实体/来源措辞泄漏检查器；公开上线前应增加输出后置扫描与人工审核队列。
- `App.tsx` 仍同时承担路由、项目请求、弹窗和布局；SSE/轮询生命周期已移到独立 Hook，但其余职责仍可继续拆分。
- 首页宣称三种导出，但工作台当前没有 PDF；隐私政策和用户条款按钮没有实际页面。

### P3

- Clipboard API 失败没有捕获和提示。

## 11. 推荐的下一步顺序

如果用户没有指定新优先级，建议按以下顺序继续：

1. 为 pg-boss 的每第 3 个新项目约 120 秒首任务延迟建立最小复现，记录 `pgboss.job.created_on/started_on` 与 Worker 生命周期，再修正通知、轮询或连接池配置；不要通过缩短任务过期时间掩盖问题。
2. 扩展 legacy `ChatResponse` 解析供应商 `usage`，将 prompt/completion Tokens 原子写回 `GenerationRun`，并增加 DeepSeek 成本汇总测试。
3. 对 `test-results/deepseek-v4-flash-2026-08-11T03-26-02-882Z/` 的 10 份剧本做人工质量评审，记录对白自然度、人物一致性、可拍摄性和实际时长，而不只看结构通过率。
4. 处理 AI SDK 依赖的 `GHSA-866g-f22w-33x8`：选择兼容的新版本，按实际类型错误调整适配器，然后重跑 lint、38 个测试和生产构建；不要使用 `--force` 直接跨大版本覆盖。
5. 使用当前 DeepSeek V4 供应商完成 PREMISE Agent tool-call 烟雾测试；验证 thinking/reasoning 字段后再考虑切换，之前保持 `GENERATION_RUNTIME=legacy`。
6. 用固定故事种子比较 legacy 与 Agent 的 Schema 成功率、延迟、Token、重试率和人工修改量；评测通过后按 CHARACTERS、LOCATIONS、BEATS、SCENES、SCRIPT 的顺序增加 Skill、Zod Schema 和领域校验器。
7. 将模型错误分为可重试、不可重试和输出校验错误，避免模型层与 pg-boss 双重无差别重试。
8. 再处理安全响应头、前端职责拆分、PDF/条款缺口和 P3。

面试演示近期上线时，可以继续使用 `DEMO_MODE=true`，固定示例和演示生成器不会产生模型费用；不要为了赶展示而跳过数据库迁移或使用弱生产密钥。任何生产部署前都必须确认 `LOCAL_UNLIMITED_MODE=false`，并重新执行生产镜像构建与健康检查。

## 12. 关键文件索引

```text
PRODUCT.md                              产品定义
DESIGN.md                               视觉与交互设计
README.md                               使用说明
start-dev.cmd                          Windows 双击启动入口
start-dev.ps1                          环境检查、Docker/数据库/迁移/前后端启动逻辑
docs/PRODUCTION_ARCHITECTURE.md         生产架构和预算边界
docs/IP_DEPLOYMENT.md                   固定公网 IP 部署步骤
docs/TREND_MONITORING.md                热点来源调研、监听配置、成本与安全转译
.env.example                            环境变量模板
docker-compose.prod.yml                 生产容器
scripts/test-10-screenplays.mjs         10 剧本真实端到端测试自动化
test-results/deepseek-v4-flash-2026-08-11T03-26-02-882Z/REPORT.md
                                        DeepSeek 10 剧本测试报告与输出索引

apps/api/prisma/schema.prisma           数据模型
apps/api/prisma/migrations/20260808050000_add_generation_versions/migration.sql
                                        生成版本迁移
apps/api/prisma/migrations/20260808070000_add_generation_jobs/migration.sql
                                        持久化任务迁移
apps/api/prisma/migrations/20260808090000_add_stage_workflow_and_expiration/migration.sql
                                        分阶段工作流与 7 天保留迁移
apps/api/prisma/migrations/20260814103000_optimize_trend_observation_indexes/migration.sql
                                        热点观察清理与最近快照索引
apps/api/src/security/                  匿名身份、ALTCHA、额度和防刷
apps/api/src/security/abuse-protection.service.ts
                                        P0 额度与非生产无限测试模式
apps/api/src/projects/                  项目 API 与所有权隔离
apps/api/src/generation/                持久化任务、六阶段生成和模型适配
apps/api/src/generation/llm.service.ts  OpenAI-compatible 请求、DeepSeek thinking 开关
apps/api/src/trends/                    热点来源、持久化快照、风险策略与 AIScript Brief
apps/api/src/agent/                     受控 AgentRuntime、Run 工具、Skill 和 Zod 校验
apps/api/src/agent/contracts/stage-agent.types.ts
                                        Agent Run/步骤/结束原因契约
apps/api/src/agent/runtime/agent-model.service.ts
                                        AI SDK 与 OpenAI-compatible 模型适配
apps/api/src/agent/runtime/stage-agent-runtime.service.ts
                                        有界工具循环、预算、超时和循环检测
apps/api/src/agent/tools/run-tool.registry.ts
                                        每 Run 独立工具白名单
apps/api/src/agent/premise-agent.service.ts
                                        PREMISE Agent 组装与受控提交
apps/api/src/agent/skills/premise/SKILL.md
                                        PREMISE Skill
apps/api/src/agent/validators/premise.schema.ts
                                        PREMISE Zod Schema

apps/web/src/App.tsx                    前端状态、路由和生成入口
apps/web/src/api.ts                     API 客户端
apps/web/src/hooks/useGenerationJob.ts  SSE、轮询恢复与连接生命周期
apps/web/src/components/LandingPage.tsx 产品首页
apps/web/src/components/TrendRadar.tsx  热点选题台与 AIScript 提示词预览
apps/web/src/components/Studio.tsx      编剧工作台
apps/web/src/sample-project.ts          固定完整示例
apps/web/src/styles.css                 全局视觉样式
```

## 13. 建议给下一会话的开场语

```text
请先阅读 D:\desktop\AI_ScriptTranfer\Idea2Screenplay-source\HANDOFF.md，
然后基于当前代码继续，不要重新设计已经确认的产品方向，也不要重复修复已经完成的两个 P0。
先告诉我你理解的当前状态和准备处理的下一项。保留 pg-boss、STAGING/ACTIVE 版本、逐阶段人工确认以及所有 P0/P1；不要引入 Bash、文件工具、MCP 或 Sub-Agent。当前本地已接通 DeepSeek V4 Flash、开启仅限非生产的 LOCAL_UNLIMITED_MODE，私有 .env 中的 Key 不得回显。先复现并修复每第 3 个新项目约 120 秒的 pg-boss 首任务延迟，再补齐 legacy Token 用量；随后处理 AI SDK 低危依赖公告和 PREMISE Agent 真实 tool-call 烟雾测试，验证通过前保持 GENERATION_RUNTIME=legacy。生产前必须关闭 LOCAL_UNLIMITED_MODE。
```
