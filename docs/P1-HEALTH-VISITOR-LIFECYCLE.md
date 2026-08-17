# P1：健康探针访客泄漏与访客生命周期

状态：已修复（2026-08-15）

## 问题与修复前证据

原来的 `VisitorMiddleware` 覆盖所有路由。无 Cookie 请求会立即创建 `AnonymousVisitor`，而生产 API 健康检查每 15 秒启动一次不保存 Cookie 的 `fetch('/api/health')`。

隔离数据库实测：初始 2 条访客，连续 5 次无 Cookie 健康请求后变为 7 条，精确 **+5**。因此即使 0 个真实用户，也会新增：

- 每分钟 4 条；
- 每天 5,760 条；
- 30 天 172,800 条。

原清理任务只删除过期 `Project`，没有删除无项目访客。SSE 断线后的 1.5 秒 HTTP 轮询还会在每个请求执行一次 `upsert lastSeenAt`；100 个轮询用户理论上可产生约 66.7 次写/秒。

## 已实施的修复

### 1. 健康路由完全绕过访客身份

中间件明确排除：

- `/api/health`
- `/api/health/live`
- `/api/health/ready`
- `GET /api/access/session`、`POST /api/access/authorize`、`POST /api/access/logout`

`/health` 与 `/health/live` 只报告进程存活，不访问数据库；`/health/ready` 同时执行 `SELECT 1`，并查询 pg-boss 安装与生成队列是否存在。生产容器探针改为 `/api/health/ready`，但该路由仍不会读取、设置 Cookie 或创建访客。

### 2. 节流 `lastSeenAt` 写入

访客身份解析移入 `VisitorIdentityService`。同一签名 Cookie 命中有界内存缓存后，默认 5 分钟内直接复用访客 ID，不再向 PostgreSQL 写入：

```env
VISITOR_LAST_SEEN_WRITE_INTERVAL_MS=300000
```

配置被限制在 10 秒至 24 小时；非法值回退为 5 分钟。缓存最多 10,000 个身份并按最旧条目淘汰，不会随随机请求无限增长。多 API 副本各自有缓存，因此最坏写频率是“每副本每访客每 5 分钟一次”，仍远低于每个请求一次。

### 3. 清理真正失联的孤儿访客

每天的项目保留任务在删除过期项目后，同时删除满足以下两个条件的访客：

- `lastSeenAt` 早于 `VISITOR_RETENTION_DAYS`，默认 30 天；
- 关联项目数为 0。

执行访客清理时仍有关联项目的身份不会被删除；配额行通过外键级联清理。如果同一轮先删除了该访客最后一个已过期项目，且其 `lastSeenAt` 也超过保留期，它会在本轮随后作为孤儿被删除，这是预期的数据回收。

`VISITOR_RETENTION_DAYS` 的有效范围为 7–365 天，非法值回退为 30 天。本修复复用现有 `AnonymousVisitor` 结构，不需要 Prisma migration。

过期项目如果仍有 `QUEUED`、`RUNNING` 或 `RETRYING` 任务，物理删除会推迟，避免级联删除正在执行的 Job 并造成模型结果提交失败。项目在 `expiresAt` 后仍会立即对用户不可见；任务进入终态后由下一轮清理物理删除。

### 4. 主动删除不会级联中断在途生成

用户主动删除项目也通过与生成入队相同的 FIFO/Serializable 事务边界。事务内会重新校验项目归属与有效期，并查询 `QUEUED`、`RUNNING`、`RETRYING` 三种活动 Job；任一活动 Job 存在时返回 HTTP 409，项目、版本、Run 和 Job 均保留。只有任务进入 `SUCCEEDED` 或 `FAILED` 等终态后才允许删除，避免 PostgreSQL 级联删除仍在供应商执行中的记录，造成付费结果无法提交。

删除检查与并发入队在 Serializable 冲突后会重放完整事务：若入队先提交，删除重试后看到活动 Job 并返回 409；若删除先提交，后续入队无法再取得该项目。两个请求不会收敛到“模型在运行但业务记录已删除”的状态。

### 5. 失败状态恢复不依赖 SSE 一直在线

真实供应商 transport 失败曾暴露一个恢复缺口：业务 Job 已进入 `FAILED`，但失败清理把 relation nested write 传给 Prisma `updateMany` 后在运行时抛错，异常又被旧的空 `catch` 吞掉，导致 Run 保持 `RUNNING`、Project 保持 `GENERATING`。页面如果当时没有 SSE 或已经刷新，仅依赖 Job 终态无法恢复这两张表。

现在 Worker 把当前 attempt 写成 `FAILED` 时，会在同一事务内修复该 Job 时间窗中的 RUNNING Run，并在项目没有其他 active Job 时把 Project 恢复为 `REVIEWING` 和 Version 的实际 `currentStage`。如果该原子事务因数据库故障整体回滚，非终态 SSE/queue reconcile 会在数据库恢复后重做；如果数据库里已经留下历史 `FAILED Job + RUNNING Run`，以下三个读入口都会执行不增加事件序号的幂等终态修复：

- `GET /api/jobs/:jobId`；
- SSE 在发送完终态事件并 complete 前；
- 项目活动任务查询在 active Job 为空时，对该项目最近的 FAILED Job 修复后仍返回 `null`。

修复只更新 `queuedAt <= Run.startedAt <= Job.completedAt` 的同 version/stage Run。Project 更新还带有 `status=GENERATING` 与 `jobs.none(active statuses)` 条件，因此旧失败任务不能回退已由新任务接管的 Project。CAS 已丢给并发 `SUCCEEDED`/其他终态时，不修改 Run、Project、事件或事件序号。

## 回归验收

自动化测试已覆盖：

- liveness 不访问 Prisma，readiness 同时检查业务数据库和 pg-boss 生成队列；
- 同一 Cookie 的第二个请求复用缓存，数据库 `upsert` 只调用一次；
- 清理任务使用“超过保留期且 projects none”条件，不会删除有项目访客；有活动 Job 的到期项目不会被级联删除。
- 主动删除在 `QUEUED`、`RUNNING`、`RETRYING` 三种状态下均返回 409；无活动 Job 才在共享 Serializable 事务内删除，事务重放会重新检查并发入队。
- Job 终态失败事务会原子修复 Run/Project；Job GET、SSE complete 和“无 active Job”的项目查询均覆盖历史残留。终态 CAS 丢失时不写共享状态，同项目已有新 active Job 时不把 Project 从 `GENERATING` 回退。

最终 no-cache 生产镜像的验收结果（全新 PostgreSQL 17）：

- `/api/health` 100 并发：100/100 为 200，p95 **87.2 ms**，`Set-Cookie=0`。
- `/api/health/ready` 100 并发：100/100 为 200，p95 **55.3 ms**，`Set-Cookie=0`。
- 两轮请求前后 `AnonymousVisitor` 均为 **1 → 1，增量 0**；该 1 条是 migration 的基线 owner，不是健康请求创建。
- 同一有效 Cookie 请求 `/api/projects` 100 次：100/100 为 200，p95 **91.5 ms**；`lastSeenAt` 精确保持 `2026-08-14T16:25:24.115Z`，窗口内数据库写入增量为 0。
- 实际向 pg-boss 投递一次 cleanup Job，队列状态为 `completed`，日志记录删除 1 个 Project 和 2 个孤儿访客：31 天纯孤儿被删除；31 天但仍有未过期项目的访客/项目均保留；过期且无活动 Job 的项目被删除，其老访客在同轮成为孤儿后也被删除；带 `RUNNING` 或 `QUEUED` Job 的两组过期项目、Job 与访客全部保留。
- 最终镜像人工构造三组 `FAILED Job/eventSequence=4 + RUNNING Run + GENERATING/PREMISE Project` 残留，分别经 Job GET、project active-job GET 和 SSE 读取后，三组均保持事件序号 4、不新增事件，Run 修为 `FAILED`，Project 修为 `REVIEWING/IDEA`。另造同项目新 `QUEUED/CHARACTERS` Job 后读取旧 FAILED Job，只修复旧 Run；Project 保持 `GENERATING/CHARACTERS`，新 Job 状态不变。
- 最终镜像主动删除黑盒：项目创建 201、challenge 200、授权 201、入队 202；任务在 `RUNNING` 时 DELETE 返回 **409**，随后 Project/Job GET 均为 200 且 Job 仍为 RUNNING。任务 `SUCCEEDED` 后 DELETE 返回 **200 `{deleted:true}`**，再次 GET Project 为 404；数据库 Project 和业务 GenerationJob 均为 0，pg-boss 仅保留 completed 审计记录。

复核步骤：

1. 记录 `AnonymousVisitor` 行数。
2. 对 `/api/health/ready` 发 100 次不带 Cookie 的请求。
3. 再次查询行数，预期增量 **0**，所有响应为 200，且无 `Set-Cookie`。
4. 用同一个有效访问 Cookie 连续请求 `/api/projects` 100 次。
5. 预期请求均成功，`lastSeenAt` 在 5 分钟窗口内保持不变。
6. 插入一个 31 天前、无项目的测试访客和一个同龄但有项目的访客，执行清理 worker；预期只删除前者。

测试必须使用隔离数据库；不要通过人为回拨生产时间验证保留策略。

## 运行观察

建议监控以下指标：

- `AnonymousVisitor` 总数、过去 24 小时新增数、无项目访客占比；
- API 路由的 `Set-Cookie` 数量，健康路由应始终为 0；
- PostgreSQL 每秒事务数与 `anonymousVisitor.update` 次数；
- 每日清理的过期项目数和孤儿访客数。
- `GenerationJob=FAILED` 但同时间窗仍存在 `GenerationRun=RUNNING` 的数量，以及 `Project=GENERATING` 但不存在 active Job 的数量；两项在正常请求/对账后都应回到 0。

如果健康探针再次导致访客增长，应先检查中间件排除路径是否因全局前缀或代理重写而失效，而不是直接缩短清理周期掩盖写入源头。
