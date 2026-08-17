# 生产部署上线风险审计报告

> 项目：Idea2Screenplay  
> 审计日期：2026-08-17  
> 审计范围：生产部署配置、API、Web、数据库迁移、成本控制、备份恢复、证书续期与运行监控  
> 结论：**REQUEST CHANGES——当前不建议直接上线真实付费生成模式**

## 1. 执行摘要

项目现有构建、测试、Lint、类型检查和 Prisma schema 检查均能通过，生产 Compose 也可在提供完整安全变量后完成配置解析。生产栈没有将 API 3000 或 PostgreSQL 5432 直接发布到宿主机，容器也具备非 root、只读根文件系统、资源限制和日志轮转等基础加固。

但静态检查、部署链路分析和针对性并发验证发现，多项上线风险没有被现有单元测试覆盖：

- 首次数据库迁移或 API 启动失败时，Web 与 ACME challenge 会同时被阻断，可能无法签发证书，也无法访问静态示例。
- 首阶段失败重试可以绕过新的验证码票据、访客/IP/日月额度和重生成次数，真实付费模式存在成本失控入口。
- 多个生成阶段只验证“数组非空”，损坏的模型结果会先被保存为成功，最终激活时才出现 500。
- 阶段保存和确认存在并发竞态，已确认内容仍可能在下一阶段入队后被修改。
- 阶段重写成功后，前端可能继续显示旧稿并永久禁用按钮；镜像更新后，已打开的旧页面可能因缺失懒加载分块而白屏。
- 活跃写流量可能使每日备份长期产不出来；恢复验证会启动完整 worker，可能在验证过程中修改刚恢复的数据。
- SSE 连接没有应用级上限；一个授权用户可以建立大量连接，持续消耗文件描述符、内存、CPU 和数据库资源。
- 当前安全状态和并发控制大量保存在单进程内，架构仅对单 API 副本安全。

因此建议把上线目标拆为三个等级：

| 上线目标 | 当前结论 | 必要条件 |
| --- | --- | --- |
| 单机、邀请码、`DEMO_MODE=true` 的 Phase 0 演示 | 有条件 NO-GO | 先修复首发启动依赖、前端发布稳定性、备份恢复和正式环境变量 |
| 单机、真实付费模型 | NO-GO | 在上述基础上修复成本额度、严格数据契约、事务竞态和成本遥测 |
| 多实例或公开 SaaS | 当前不支持 | 将票据、验证码 nonce、限流、撤销和全局并发状态持久化，并补齐账号与运维体系 |

## 2. 严重程度定义

- **P0**：可导致匿名远程接管、大规模秘密泄露或不可接受的数据破坏，必须立即停止发布。
- **P1**：可确定阻断首发、造成真实费用失控、数据不一致、恢复失效或核心功能不可用，上线前应修复。
- **P2**：重要安全、可靠性、体验或可运维性缺口；可在严格限制的内测范围内短期接受，但必须安排修复。
- **P3**：低风险加固、清理或长期维护问题。

本次未发现 P0。

## 3. P1：上线前必须处理

### P1-01 API 失败会同时阻断 Web、静态示例和 ACME

**证据**

- [`docker-compose.prod.yml`](../docker-compose.prod.yml) 第 141–143 行：`web` 以 `condition: service_healthy` 等待 `api`。
- [`docker-compose.bootstrap.yml`](../docker-compose.bootstrap.yml) 第 1–3 行：bootstrap 仅覆盖 Web command，因此继承上述依赖。
- [`apps/api/Dockerfile`](../apps/api/Dockerfile) 第 36 行：API 启动前先执行 `prisma migrate deploy`。
- [`apps/web/Caddyfile.bootstrap`](../apps/web/Caddyfile.bootstrap) 第 8–23 行：ACME challenge、SPA 和 API 代理均由该 Web 服务提供。

**触发与影响**

首次数据库初始化、migration、pg-boss 或 API 启动失败时，Web 容器不会启动。结果是证书 challenge 无法访问、首页和 `/workspace/sample` 也不可用，和部署文档中“后端不可用时示例仍可浏览”的目标冲突。

**建议**

移除 `web -> api` 的健康依赖，让 Caddy 独立启动；API 不可用时仅让 `/api/*` 返回 503。另一种方案是拆出独立的 ACME/static 服务。

### P1-02 首阶段失败重试绕过成本额度

**证据**

- [`apps/api/src/generation/generation.controller.ts`](../apps/api/src/generation/generation.controller.ts) 第 62–69 行：阶段重新生成路由不要求新的 generation ticket。
- [`apps/api/src/generation/generation-jobs.service.ts`](../apps/api/src/generation/generation-jobs.service.ts) 第 139–167 行：`PREMISE` 且 `currentStage=IDEA` 时走 `retryingFirstStage`，跳过 `regenerationsUsed`。

**触发与影响**

首个付费阶段已经调用供应商但失败后，项目仍停留在 IDEA。持有访问码的用户可以串行重复调用该路由。初始工作流消费过的访客/IP/日月额度无法约束这些后续 provider 调用；Agent 模式一次任务还可能包含多次模型调用。

**建议**

所有可能进入 provider I/O 的手动任务都必须在同一事务中预占持久化额度。首阶段失败重试也应要求新的 ticket，并设置项目、访客和 provider-attempt 上限。供应商控制台还应设置金额硬限额，而不是只依赖应用工作流次数。

### P1-03 生成阶段缺少严格运行时数据契约

**证据**

- [`apps/api/src/generation/dto/update-stage.dto.ts`](../apps/api/src/generation/dto/update-stage.dto.ts) 第 1–5 行：人工更新只要求顶层对象。
- [`apps/api/src/generation/generation.service.ts`](../apps/api/src/generation/generation.service.ts) 第 521–617、672–739、971–986 行：地点、节拍、场景和剧本主要只检查数组非空。
- 同文件第 394–452 行：最终激活时才将这些字段写入具备必填约束的业务表。

**已验证行为**

使用当前构建产物实际调用校验器时：

- `locations: [{}]` 被接受；
- `beats: [{}]` 被接受，并只补充了默认编号；
- `scenes: [{}]` 被接受，并只补充了编号和默认时长。

**影响**

损坏结果会先被保存为成功，后续 prompt 可能出现 `undefined`；最终 `createMany` 才因必填字段缺失失败。用户已经等待并支付了模型调用费用，但项目会在激活时 500 或卡死。

**建议**

为六个阶段建立共享的严格 Zod schema，校验字段类型、字符串长度、数组数量、额外字段、编号唯一性和跨阶段引用。模型结果必须在任务标记成功前校验；人工输入无效时返回 422。

### P1-04 阶段保存和确认存在 TOCTOU 竞态

**证据**

- [`apps/api/src/generation/generation.service.ts`](../apps/api/src/generation/generation.service.ts) 第 353–374 行：版本状态、active job 检查和最终 update 分离执行。
- [`apps/api/src/generation/generation-jobs.service.ts`](../apps/api/src/generation/generation-jobs.service.ts) 第 198–255 行：确认和入队使用另一事务。

**触发与影响**

客户端同时 PATCH 当前阶段并确认时，PATCH 可以先通过检查；确认事务随后锁定阶段并将下一阶段入队；PATCH 最后仍无条件更新已经确认的版本。下一阶段读取修改前还是修改后的内容取决于时序，版本血缘不再可靠。

**建议**

将检查与更新放入同一个 Serializable 事务，或使用同时包含 `currentStage`、`confirmedStage` 和 active-job 条件的 `updateMany` CAS，并要求更新数必须为 1。

### P1-05 阶段重写成功后仍显示旧稿且界面永久忙碌

**证据**

- [`apps/web/src/components/Studio.tsx`](../apps/web/src/components/Studio.tsx) 第 225–226 行：编辑器 key 只有 `draft.id-stage`。
- 同文件第 338 行：本地 `content` 只在首次挂载初始化。
- 同文件第 371–380 行：重写成功路径没有清除 `busy`，只有失败分支清除。

**触发与影响**

用户点击“重写本阶段”并成功后，后端复用同一个 generationVersion ID；组件不会重新挂载，也不会同步新稿。页面继续显示旧内容，所有操作按钮保持禁用，直到完整刷新。

**建议**

使用 `draft.updatedAt` 或显式版本号同步服务端稿件，同时保护用户尚未保存的本地编辑；将 busy 清理放入 `finally`。补充 rerender 测试，断言新内容出现且按钮恢复。

### P1-06 镜像更新后旧页面可能因懒加载分块缺失而白屏

**证据**

- [`apps/web/src/components/Studio.tsx`](../apps/web/src/components/Studio.tsx) 第 35 行：人物图谱使用动态 import。
- [`apps/web/Dockerfile`](../apps/web/Dockerfile) 第 13 行：镜像只包含当前版本 dist。
- [`apps/web/Caddyfile`](../apps/web/Caddyfile) 第 30–44 行：缺失资源会回退到 `index.html`，`/assets` 仅额外设置缓存头。
- [`apps/web/src/main.tsx`](../apps/web/src/main.tsx) 第 12–15 行：根节点没有 ErrorBoundary。

**触发与影响**

用户在发布前打开页面，发布新镜像后才第一次进入人物图谱。旧主 bundle 请求已经删除的旧 hash JS；Caddy 返回 HTML，动态 import 因 MIME/解析错误失败，应用可能直接白屏。

**建议**

- `/assets/*` 缺失时返回真实 404，不做 SPA fallback；
- `index.html` 设置 `Cache-Control: no-cache`；
- 发布时保留上一版 hash 资源或采用蓝绿切换；
- 监听 Vite `vite:preloadError` 并安全刷新；
- 增加根 ErrorBoundary 和恢复入口。

### P1-07 活跃写流量可能让备份长期产不出来

**证据**

- [`scripts/backup-postgres.sh`](../scripts/backup-postgres.sh) 第 181–192 行：pg_dump 前后分别生成表计数 manifest，并要求字节完全一致。
- [`docs/P2-DATABASE-BACKUP-RESTORE.md`](P2-DATABASE-BACKUP-RESTORE.md) 第 63–82 行：每天只运行一次，脚本内没有重试。

**触发与影响**

生成任务、趋势刷新或其他写入发生在 dump 窗口时，即使 PostgreSQL MVCC dump 本身是一致快照，脚本仍会丢弃它。持续活跃时可能数天都没有新备份。

**建议**

让 manifest 与 pg_dump 使用同一个 exported snapshot；至少增加有界退避重试、明确失败指标和可到达的告警消费者。

### P1-08 恢复验证会修改刚恢复的数据

**证据**

- [`docker-compose.restore.yml`](../docker-compose.restore.yml) 第 22–45 行：恢复验证启动完整 API，并启用 Demo worker。
- [`apps/api/src/generation/generation-jobs.service.ts`](../apps/api/src/generation/generation-jobs.service.ts) 第 96–98 行：API 启动时注册生成 worker。
- [`apps/api/src/trends/trends.service.ts`](../apps/api/src/trends/trends.service.ts) 第 77–98 行：启动时异步执行 retention/refresh。
- [`scripts/verify-postgres-restore.sh`](../scripts/verify-postgres-restore.sh) 第 157–207 行：先比较表计数，之后才等待 API ready。

**影响**

恢复出的排队任务可能被执行，过期数据可能被清理。如果修改发生在计数之后，验证脚本甚至可能 PASS，但数据库已经变化；也可能因为竞态产生不稳定失败。

**建议**

增加 `RESTORE_VERIFY_MODE`，彻底禁用 worker、scheduler、retention、趋势刷新和外部请求；更稳妥的方案是使用独立只读 smoke 程序验证恢复结果。

### P1-09 同机恢复演练可能拖垮 2GB 生产机

**证据**

- [`docker-compose.restore.yml`](../docker-compose.restore.yml) 第 4–51 行：第二套 PostgreSQL/API 没有内存、PID 或 CPU 边界。
- [`docs/PRODUCTION_ARCHITECTURE.md`](PRODUCTION_ARCHITECTURE.md) 第 78–84 行：现有生产容器计划已使用约 1.5GB。

**影响与建议**

`pg_restore` 加第二套数据库/API 与线上服务并行时，可能造成 OOM、容器被杀或严重 IO 延迟。恢复演练应在独立主机或 CI 上进行；若只能同机，应安排维护窗并设置严格资源限制。

### P1-10 灾难恢复链路不完整

**证据**

- [`docs/P2-DATABASE-BACKUP-RESTORE.md`](P2-DATABASE-BACKUP-RESTORE.md) 第 36、204–209 行：目前仅保留同机 7 份，没有异地副本或 PITR。
- [`docs/IP_DEPLOYMENT.md`](IP_DEPLOYMENT.md) 第 16、32 行：`VISITOR_IDENTITY_KEY` 建立身份后不得改变。
- [`apps/api/src/security/visitor-identity.service.ts`](../apps/api/src/security/visitor-identity.service.ts) 第 171–189 行：身份由该密钥和 seat 前缀稳定派生。

**影响**

整机或磁盘丢失会同时失去数据库与身份密钥。即使另有数据库 dump，没有原 `VISITOR_IDENTITY_KEY` 也无法将原 seat 重新关联到项目。

完整访问码的随机后缀可以用相同 seat 编号重新生成；真正必须离机托管的是 `VISITOR_IDENTITY_KEY` 与 seat 到用户的分配关系。

**建议**

建立加密、离机、可定期恢复验证的数据库和核心身份秘密备份；补充生产卷切换、验收、回滚和密钥轮换边界。

### P1-11 SSE 连接无界

**证据**

- [`apps/api/src/generation/generation.controller.ts`](../apps/api/src/generation/generation.controller.ts) 第 103–110 行：提供 job SSE。
- [`apps/api/src/generation/generation-jobs.service.ts`](../apps/api/src/generation/generation-jobs.service.ts) 第 298–310、330–360、418–455 行：每个连接进入无上限 Set，并每 750ms 扫描、查询和派发。

**影响与建议**

一个授权用户即可对同一 job 建立大量连接，耗尽文件描述符、内存、CPU 和数据库容量。应在 Caddy 与应用层同时设置每 IP、访客、job 和全局连接上限，并增加最大连接寿命、慢客户端背压和连接数指标。

### P1-12 当前架构仅对单 API 副本安全

**证据**

- [`apps/api/src/security/access.service.ts`](../apps/api/src/security/access.service.ts) 第 17 行：登录失败窗口在进程 Map。
- [`apps/api/src/security/abuse-protection.service.ts`](../apps/api/src/security/abuse-protection.service.ts) 第 118–123、211–295 行：验证码 nonce、ticket、速率窗口和 activeGenerations 都在内存。
- [`apps/api/src/generation/generation-queue.service.ts`](../apps/api/src/generation/generation-queue.service.ts) 第 56–68 行：worker 并发是每进程配置。

**影响**

两个 API 副本或滚动切换时，A 签发的 ticket 路由到 B 会失效；验证码和登录失败限制可跨实例绕过；全局生成并发会变成配置值乘以副本数。

**建议**

当前部署必须固定单副本并采用先停后启。扩容前，将 ticket、challenge nonce、限流和撤销状态迁移到 Redis/数据库，并使用全局 worker 并发信号量。

### P1-13 短期证书、备份和运行时失败缺少真实告警

IP 地址证书有效期约 160 小时，续期失败留给人工处理的时间很短。当前手册依赖人工安装 cron，但没有仓库内受版本控制的 systemd unit、`OnFailure` 消费者或外部证书到期监测。Docker 的 `unhealthy` 状态本身也不会触发 `restart: unless-stopped` 重启。

应落地外部 HTTPS/证书监测、磁盘/备份失败告警、API/队列指标和可到达的通知渠道。

参考：

- [Let's Encrypt：IP 地址证书正式可用](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability.html)
- [Let's Encrypt：短期证书和 Certbot IP 支持](https://letsencrypt.org/2026/03/11/shorter-certs-certbot.html)

### P1-14 发布流程不可原子回滚

API 镜像启动时自动 migration；部署手册采用目标机本地 build、备份和 `up -d`，没有独立 migrator、不可变镜像版本、自动 smoke gate 或 schema rollback。迁移或新应用失败时，API 会进入重启循环，旧版本也未必兼容新 schema。

建议采用 off-host/CI 构建的不可变镜像、一次性 migration job、expand-contract 迁移、`up --wait` 加外部 smoke gate，并明确旧镜像与数据库回滚边界。

## 4. P2：重要但可分阶段修复

### 安全与成本控制

1. **CAPTCHA 一次性验证存在并发竞态**  
   [`abuse-protection.service.ts`](../apps/api/src/security/abuse-protection.service.ts) 第 211–232 行在异步校验后才标记 challenge 已使用。使用真实 `altcha-lib` 的并发验证中，同一 challenge/solution 20 次请求全部成功签发 ticket。应先原子占用 nonce，失败时再释放；生产应使用持久化唯一约束。

2. **访问 Cookie 没有服务端有效期或撤销能力**  
   [`visitor-identity.service.ts`](../apps/api/src/security/visitor-identity.service.ts) 第 121–132、196–206 行只验证签名与当前访问码集合。被盗 Cookie 可在浏览器 30 天过期后手工重放，直到访问码轮换。应签入 `iat`、`exp`、`sessionId` 并维护撤销状态。

3. **前端没有退出席位入口**  
   后端已有 logout API，但 Web 未使用。共享电脑上的后续使用者会继承相同席位、项目和额度。

4. **Agent 失败调用的成本遥测记为零**  
   多个付费 step 后再失败时，telemetry 只在整体成功路径返回，数据库会记录 `providerCallCount=0`。应逐 step 在 `finally` 中持久化调用、耗时、usage 和失败状态。

5. **LLM 响应体没有服务端字节上限**  
   [`llm.service.ts`](../apps/api/src/generation/llm.service.ts) 第 174–188 行直接 `response.json()`。异常或错误配置的 provider 可返回巨大 body，使 API 容器 OOM。

### 前端可靠性与体验

6. **活动任务恢复失败被静默忽略**  
   [`apps/web/src/App.tsx`](../apps/web/src/App.tsx) 第 183–197 行仅处理 project 查询失败。刷新生成中项目时，如果 active-job 查询瞬时失败，页面会把 `generating` 当作 false 且不再监控后台任务。

7. **SSE 首次错误后永久降级轮询**  
   浏览器自带的 EventSource 重连被立即关闭，断网后可能每 30 秒静默轮询数小时，用户没有离线或恢复状态提示。

8. **所有 fetch 缺少客户端超时**  
   半开连接可能让访问门禁、保存、创建或删除一直保持 busy。应统一设置 AbortSignal timeout，只对幂等 GET 做有界重试。

9. **删除项目和保存场景失败没有反馈**  
   多个事件处理器通过 `void` 丢弃 rejected Promise，可能产生未处理拒绝，用户无法判断数据是否保存。

10. **畸形深链接可能在 React 首次渲染前崩溃**  
    `/workspace/%` 会让直接调用的 `decodeURIComponent` 抛 `URIError`；根节点没有错误边界，结果为空白页。

### 数据、数据库与运行边界

11. **失联 active job 可让七天项目永久逃过清理**  
    retention 永久跳过 `QUEUED/RUNNING/RETRYING` 项目，而状态修复只在用户 GET/SSE 时发生。需要后台 reconciler 将超过最大窗口的任务标记失败，再执行清理。

12. **API 运行时使用 PostgreSQL 初始化超级用户**  
    [`docker-compose.prod.yml`](../docker-compose.prod.yml) 第 13–16、39 行为 API 和数据库初始化使用相同身份。应拆出一次性 owner/migrator，API 和 pg-boss 使用独立最小权限角色。

13. **Web、API、PostgreSQL 共用一个桥接网络**  
    Web 被攻陷后可直接探测数据库。建议拆分 edge 网络和 `internal: true` 的 db 网络。

14. **秘密保存在容器环境变量中**  
    Docker 管理员可通过 inspect 看到数据库 URL、访问码和密钥。应支持 `_FILE` 或外部 secrets；至少严格限制 Docker socket 和 docker 组。

15. **缺少集中式生产环境变量校验**  
    非法数字、URL、布尔值和跨字段约束有的静默回退、有的直到首次付费任务才失败。应在 `ConfigModule.forRoot` 使用严格 schema 并 fail-fast。

### 部署与供应链

16. **默认开发 Compose 会将弱口令 PostgreSQL 绑定到所有接口**  
    [`docker-compose.yml`](../docker-compose.yml) 第 8–12 行使用公开的 `screenwriter/screenwriter`，并发布 `5433:5432`。生产机误运行默认命令会暴露数据库。应改为 `127.0.0.1:5433:5432` 并使用显式 dev profile/文件名。

17. **基础镜像标签未固定 digest**  
    Node、Caddy、PostgreSQL 和 Certbot 标签会漂移。应固定受控版本和 digest，保存 SBOM 与扫描记录。

18. **Web 缺少健康检查、访问日志和完整浏览器安全头**  
    当前没有 CSP、`frame-ancestors`/X-Frame-Options，也没有 Web healthcheck 和访问日志。

19. **目标 2GB VPS 上执行完整 Node 构建风险较高**  
    更新期间构建会与线上容器争抢内存、swap、磁盘和 IO。建议在 CI/off-host 构建并拉取不可变镜像。

20. **生产依赖存在低危资源消耗公告**  
    官方 npm registry 审计报告 `@ai-sdk/provider-utils` 依赖链有 4 个 low severity 结果，关联 [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8)。当前默认运行时不依赖 AI SDK Agent，因此不是首发阻断，但应持续跟踪兼容升级。

## 5. P3：低风险清理与长期加固

- [`apps/web/nginx.conf`](../apps/web/nginx.conf) 已无仓库引用，实际镜像使用 Caddy；该配置还缺少 `X-Forwarded-For`/`X-Forwarded-Proto`，误用时会把所有用户折叠为同一 IP。建议删除或明确标记为历史配置。
- 根目录同时存在 `package-lock.json` 和不完整的 `pnpm-lock.yaml`，但文档和 Dockerfile 都使用 npm。确认外部 CI 未使用 pnpm 后，建议删除陈旧 lockfile。
- 健康接口公开模型名和是否启用真实付费模式。公开 liveness 只需返回状态，详细信息应放到受保护的运维端点。
- SSE 事件数组跨阶段累积；可只保存最新事件或限制最近若干条。
- 移动端项目删除控件依赖 hover 且使用嵌套交互角色，应改为并列真实按钮。
- Dockerfile 构建阶段 `COPY . .`；尽管 `.dockerignore` 已排除已知秘密，长期仍建议改为目标化 COPY 白名单。

## 6. 当前环境与秘密检查

本次仅检查变量是否存在、是否为空、是否为公开开发默认值及布尔模式，未输出任何秘密值。

当前根 `.env` 是开发配置，不能用于生产：

- 缺少生产 PostgreSQL 密码、稳定身份密钥和访问码；
- Cookie、IP 和 ALTCHA 密钥仍为开发默认值或缺失；
- 配置了非空模型 API Key；
- `DEMO_MODE=false` 且本地无限模式开启。

生产 Compose 会拒绝缺失或公开开发密钥，但仍必须注意：

- 不要把根 `.env` 复制到服务器；
- 按 [`docs/IP_DEPLOYMENT.md`](IP_DEPLOYMENT.md) 创建权限为 600 的服务器专用 `.env.production`；
- 如果当前源码目录曾被上传、共享或进入过无法核实的历史仓库，应轮换现有模型 API Key；
- `VISITOR_IDENTITY_KEY` 建立身份后必须加密离机托管，不可随意更换；
- Phase 0 应保持 `DEMO_MODE=true` 且 `LLM_API_KEY` 为空。

## 7. 已通过的验证

| 检查项 | 结果 |
| --- | --- |
| API 测试 | 24 suites / 205 tests 通过 |
| Web 测试 | 7 files / 29 tests 通过 |
| 总测试数 | 234 tests 通过 |
| ESLint | 通过 |
| TypeScript | 通过 |
| Vite 生产构建 | 通过 |
| Prisma schema validate | 通过 |
| Production/Bootstrap/Restore Compose | 使用安全占位变量执行 `config --quiet` 均通过 |
| Web 生产依赖 audit | 0 个已报告漏洞 |
| 根/API 生产依赖 audit | 4 个 low severity |

已确认的积极项：

- 未发现直接 `dangerouslySetInnerHTML`、`innerHTML`、`eval` 等明显 XSS sink；React 文本节点会转义业务和模型内容。
- 未发现直接 IDOR；project、scene、job 和 SSE 握手均检查访客所有权。
- 生产仅发布 80/443，API 和 PostgreSQL 不映射宿主端口。
- API 使用非 root、只读根文件系统、capability drop、PID/内存和日志限制。
- `.dockerignore` 与 `.gitignore` 排除了 `.env*`、证书私钥和本地数据库。
- 备份脚本已有 root-only 权限、原子发布、SHA-256、目标标签、空库校验和 single-transaction restore 等良好基础。
- 未挂载 Docker socket。

## 8. 尚未完成的验证

- 当前 Docker Desktop Linux daemon 未运行，因此未完成实际 API/Web 镜像构建。
- 本地 PostgreSQL 未运行，因此未完成真实 `prisma migrate deploy`、partial index 和 pg-boss 事务验证。
- 未完成 HTTP、Cookie、SSE、并发生成和重启恢复的端到端测试。
- 未在目标 VPS 核实防火墙、SSH、swap、磁盘、cron、证书、续期 reload、文件权限和告警渠道。
- 未进行中国移动、联通、电信及微信内置浏览器、iOS Safari、Android 浏览器的真实访问测试。
- 未进行 15–30 分钟真实模型的质量、截断、延迟和金额测试。
- 源码目录不是 Git 仓库，无法核实历史提交是否曾包含秘密，也无法提供基于 commit 的变更审计。

## 9. 推荐修复和上线顺序

### 阶段 A：修复首发基础链路

1. 解除 Web/ACME 对 API 健康状态的启动依赖。
2. 修复 `/assets` fallback、旧分块恢复和根 ErrorBoundary。
3. 修复阶段重写旧稿与永久 busy。
4. 修复备份一致性、恢复只读模式和 restore 资源边界。
5. 建立异地加密数据库与 `VISITOR_IDENTITY_KEY` 灾备。
6. 建立证书、备份、磁盘、API 和队列外部告警。

### 阶段 B：部署 Phase 0 演示

1. 只运行一个 API 副本。
2. 创建全新的 `.env.production`、随机密钥和独立访问码。
3. 保持 `DEMO_MODE=true`，模型 Key 为空。
4. 使用不可变镜像和独立 migration job。
5. 执行外部 HTTPS、静态示例、访问门禁、项目隔离和 SSE 冒烟测试。
6. 手工完成一次离机备份恢复演练。

### 阶段 C：开放真实模型

1. 修复首阶段额度绕过。
2. 为所有阶段增加严格 schema。
3. 修复阶段保存/确认事务竞态。
4. 对 CAPTCHA nonce 和 generation ticket 做原子、持久化消费。
5. 增加 SSE 连接上限和 LLM 响应大小上限。
6. 补齐失败 provider 调用的成本遥测。
7. 在供应商侧配置金额告警和硬限额。
8. 完成真实模型质量、截断、延迟和成本验收后，再将 `DEMO_MODE` 切换为 false。

### 阶段 D：扩容或公开服务

1. 将内存票据、nonce、限流、撤销和并发状态迁移到 Redis/数据库。
2. 引入全局 worker 信号量和多实例端到端测试。
3. 增加正式账户、退出、设备/session 管理、隐私删除和审计能力。
4. 使用蓝绿或滚动兼容发布，并验证旧/新 schema 双向兼容窗口。

## 10. 上线前最终检查清单

### 必须完成

- [ ] Web/ACME 可在 API 不健康时独立启动。
- [ ] `/assets/*` 缺失返回 404，旧页面不会白屏。
- [ ] 阶段重写后展示新稿且按钮恢复。
- [ ] 首阶段失败重试会消费持久化额度和新 ticket。
- [ ] 六个阶段具备严格运行时 schema。
- [ ] 阶段保存和确认使用原子事务/CAS。
- [ ] SSE 具备应用层和代理层连接上限。
- [ ] 活跃写流量下备份可以稳定成功，并有失败告警。
- [ ] 恢复验证不会启动 worker、清理任务或外部刷新。
- [ ] 数据库和核心身份密钥存在加密异地副本。
- [ ] 使用全新的服务器专用 `.env.production`。
- [ ] Phase 0 保持 Demo 模式且不配置付费模型 Key。
- [ ] 目标 VPS 防火墙只开放 SSH、80、443。
- [ ] PostgreSQL 5432 和 API 3000 未发布公网。
- [ ] HTTPS、证书续期 reload 和到期告警均已验证。
- [ ] 外部 smoke、Cookie 隔离、SSE 和重启恢复测试通过。

### 启用真实模型前必须完成

- [ ] 供应商金额告警和硬限额生效。
- [ ] 失败调用也能记录 provider 次数和 token/cost。
- [ ] 15–30 分钟真实生成质量、截断、延迟和成本验收通过。
- [ ] 每日、每月、IP、访客、项目和 provider-attempt 限额均有并发测试。
- [ ] 模型空响应、无效 JSON、超时和限流均可恢复且不会损坏项目。

## 11. 审计范围与限制

本次审计覆盖约 163 个源码、部署、脚本和文档文件，并执行了现有自动化质量门及若干针对性运行验证。未修改应用代码。

本报告不代表目标服务器已经通过验收。防火墙、安全组、Docker daemon、文件权限、cron、证书、备份介质、供应商控制台和外部网络质量必须在实际 VPS 上单独验证。
