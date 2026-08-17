# P1：模型重试与成本遥测

状态：已修复（2026-08-15）

## 修复前证据与根因

原 `LlmService.generateJson` 用一个宽泛 `catch` 包住结构化请求：无论 401、429、5xx、超时、网络错误、空响应还是 JSON 解析错误，都会立即再发一次不带 `response_format` 的上游请求。pg-boss 同时配置 `JOB_RETRY_LIMIT=2`，因此一个阶段在三次 Job attempt 中最坏会触发 **6 次模型 HTTP 调用**；单次超时上限 90 秒时，唯一 worker 最坏可被同一阶段占住约 **540 秒**，并产生重复费用。

部署侧还存在同一风险：旧 API 容器的 `docker top` 显示 PID 1 是 `sh -c ...`、Node 是子进程；对无付费任务的旧容器执行 `docker stop --timeout 10` 实际耗时 **10.7 秒**并打满超时，证实 SIGTERM 没有正常传到 Nest。旧 `stop_grace_period=35s` 即使调大，也不能保证 pg-boss 收尾。

现有开发库的只读基线为 78 条 `GenerationRun`，`promptTokens` 和 `completionTokens` **78/78 全部为 NULL**。这些 Run 均有模型名和阶段，但无法从数据库还原实际调用次数或 Token，因此不能用现有“月 100 次”项目级计数核对供应商账单。

根因是模型兼容性降级、供应商故障、付费后的数据库提交和业务 Job 重试没有分类边界，同时 Legacy Chat Completions 响应没有把 `usage` 与每次 HTTP attempt 持久化。即使模型返回 HTTP 200，只要输出缺字段或保存结果的 Serializable 事务冲突，旧 Worker 也会重跑整个 Job，再次调用模型。

## 目标

生产当前默认 `GENERATION_RUNTIME=legacy`。Legacy JSON 生成路径不再对所有错误无差别追加一次模型调用；该路径的每个真实上游请求都记录结果、耗时和供应商返回的 Token 用量，阶段成功或失败都会把遥测与对应的 `GenerationRun` 一起保存。可选 Agent 路径目前只保存 steps/Token 聚合，不写逐调用 `GenerationProviderCall`，`providerDurationMs` 也为 `null`；Agent 逐调用遥测不在本 P1 范围。

## 重试边界

模型适配层只在一个条件下做一次兼容性降级：供应商以 HTTP 400/422 明确说明不支持 `response_format` 或 `json_object`。第一次请求记录为 `unsupported_response_format`，随后只重试一次不带 `response_format` 的请求。

以下情况不会在模型适配层再次调用供应商：

- 401/403：`authentication`
- 408 或本地请求超时：`timeout`
- 429：`rate_limit`
- 5xx：`provider_unavailable`
- 其他 4xx：`client_error`
- 网络错误：`transport`
- 非 JSON HTTP 响应、空内容或无效模型 JSON：`invalid_response`

当前模型接口没有跨供应商可验证的幂等键。一旦请求离开进程，429、408、本地超时、5xx 或断连都可能是“供应商已经处理/计费，但客户端没有拿到确定结果”。因此这些模型失败全部标记为 `retryable=false`，Worker 结束业务 Job，等待用户显式重试；不会把它们交回 pg-boss 自动再调用模型。

Worker 在任何付费边界前先原子领取 pg-boss attempt：首次执行匹配 `QUEUED/attempt=0`；后续执行可匹配 `RETRYING` 或进程硬崩溃遗留的 `RUNNING`，但业务 attempt 必须不高于当前 `retryCount`。领取事务把 attempt 单调改成 `retryCount+1`、增加事件序号并写入唯一的 `job:running` 事件。同一 `retryCount` 的重叠投递在第一次领取后，业务 attempt 已是 `retryCount+1`，因此第二个投递不再满足 CAS；如果某次非首次领取事务确定回滚、pg-boss 的 retryCount 仍继续增加，下一次投递也能从落后的业务 attempt 恢复，不会把队列误完成。领取事务若抛错而无法确认提交，Worker 直接把原错误交回 pg-boss；事务确定回滚时下一次重试仍可领取，若只是提交响应丢失，下一次重试则从 `RUNNING/旧 attempt` 恢复。

真正调用模型前还会在一个事务中按 `Job id + RUNNING + expectedAttempt` 锁定并验证所有权，然后依次写项目状态、`stage:start` 事件并创建 `GenerationRun`。任一步失败都会整体回滚，不留下 Run，有限 Job 重试仍安全；一旦事务提交，Run 已经可见，较新的 attempt 会按结果未知停止。该 Job 行锁同时封住“旧 attempt 尚未创建 Run、新 attempt 已领取”的交错：旧 attempt 若先提交 Run，新 attempt 随后必能看见 Run；新 attempt 若先取得所有权，旧 attempt 的边界 CAS 失败且不会调用模型。

供应商一旦明确拒绝 `response_format`，服务进程会记住该能力边界，后续请求直接使用非结构化参数。普通模型失败最多一次上游请求；只有首次确认结构化参数不兼容时最多两次，且第二次是同一次用户操作中的确定性兼容降级。

## 付费后的边界

- 模型返回可解析 JSON、但字段/数组/人物关系不满足阶段契约时，抛出 `invalid_output` 的不可重试错误；HTTP 200 不再意味着可以自动重跑付费阶段。
- 模型结果生成后，Serializable 提交通过统一重试器最多只重跑数据库事务 8 次，模型调用保持在事务外，不会随 P2034/SQLSTATE 40001 重放。
- 若事务重试耗尽或发生其他提交错误，任务以 `result_persistence` 停止自动重试。用户可在数据库恢复后手动重试，但系统不会在结果未知时自行产生第二笔费用。
- 结果提交事务在任何 Version/Run/Project/Job 写入前，先按 `Job id + RUNNING + expectedAttempt` 锁定所有权；旧 attempt 已被新 retry 或停止路径取代时，只在该 attempt 自己的 Run 上补记调用次数/Token/耗时，不改变 Run 状态，也不会用迟到的结果覆盖共享草稿、项目状态或终态事件。错误清理同样先做 attempt fence，并只把仍为 `RUNNING` 的 Run 条件更新为失败。失败路径把 Run 的纯标量遥测交给 `updateMany`，逐调用明细则在同一事务用 `GenerationProviderCall.createMany(skipDuplicates)` 写入；不会再把 relation nested write 塞进 Prisma 不支持的 `updateMany.data`。若结果事务实际提交成功、但客户端丢失 COMMIT ACK，清理事务会看到 Job 已是 `SUCCEEDED`，因此不会把 `COMPLETED` Run 反写为失败，也不会把 Project 阶段回退。清理事务本身失败会记录带 Job id 的错误日志，同时保留原始模型错误。
- Worker 对 `SUCCEEDED` 和 `FAILED` 两种终态重投都直接跳过。若同一 Job 的 `queuedAt` 之后、相同 version/stage 已存在任意 Run，说明上一次已经越过了可安全自动重试的前置边界；重投会以“结果未知”终止，而不是自动再调用。
- “既有 Run”停止路径也使用 `Job id + active status + expectedAttempt` 条件更新。若并发完成已经把 Job 写成 `SUCCEEDED`/`FAILED`，CAS 命中数为 0，只重读终态，不写错误事件，也不把 Run 反写为失败；只有仍拥有 attempt 的 Worker 才能增加一次事件序号并写停止事件。
- 不可重试错误后的 Job 失败事件即使因数据库故障无法落盘，也不会覆盖原错误并触发 pg-boss 重试；队列完成后，下一次 Job GET、project active-job GET 或仍在线 SSE 的周期对账会调用 `reconcileQueueState` 修复业务 Job 状态。对账修复在同一事务中绑定读到的 `id + status + attempt + eventSequence` 快照；只有 CAS 命中才增加序号并写入一条错误事件，命中数为 0 时重读最新状态。因此旧 `RUNNING` 快照既不能覆盖 `SUCCEEDED`/`FAILED` 终态，也不能把刚领取的新 `RUNNING` attempt 降回 `RETRYING`。
- 当前 attempt 被写成 `FAILED` 时，同一个事务还会把该 Job 时间窗内、同 version/stage 且仍为 `RUNNING` 的 Run 条件更新为 `FAILED`，再从 STAGING Version 读取实际 `currentStage`。只有 Project 仍为 `GENERATING` 且不存在任何其他 `QUEUED/RUNNING/RETRYING` Job 时，Project 才回到 `REVIEWING`；Version 继续保留 `STAGING`，用户可以在原阶段手动重试。这个原子闭环同时用于不可重试错误、既有 Run 停止和 queue terminal reconcile，避免出现“Job 已 FAILED，但 Run 永久 RUNNING、Project 永久 GENERATING”。Run 查询同时使用 `queuedAt <= startedAt <= completedAt`，不会误伤后创建 Job 的 Run。
- pg-boss 的完成 SQL 没有 delivery token；在数据库/心跳长期异常的极端情况下，过期旧 handler 理论上可能确认掉同 ID 的新 delivery。运行时把 `JOB_EXPIRE_SECONDS` 下限钳制为“最长付费 handler 窗口再加 30 秒”（默认超时配置下最低 240 秒，默认 900 秒保持不变），并且 terminal reconcile 对刚领取但尚未建 Run 的 Job 保留 30 秒短宽限，对仍在最大模型窗口内的 `RUNNING` Run 保留完整付费宽限；FAILED Run 则立即修复。结合 attempt 与结果 fence，这个外部库边界不会造成第二次自动付费或覆盖终态；最坏是在数据库/心跳长时间故障后转为 `FAILED`，由用户手动重试。
- 持续打开的 SSE 不再只看业务 Job 表：非终态连接建立时立即对账，此后最多每 15 秒查询一次 pg-boss；队列已 completed/failed/cancelled 而业务 Job 仍为 `RUNNING` 时，数据库恢复后会补一条 `error` 事件并关闭连接。SSE 在终态 `FAILED` 完成前还会做一次不增加 Job 事件或序号的一致性修复；页面刷新后的 `GET /jobs/:id` 也会执行同一幂等修复。若页面只查询项目活动任务且已没有 active Job，`getActiveForProject` 会修复该项目最近的 FAILED Job 后仍返回 `null`，所以恢复不依赖当时必须存在 SSE 连接。活跃队列不会被误终止。100 条同时在线的 SSE 在初次查询后，稳态额外队列查询上限约为 `100 / 15 = 6.7 次/秒`，而不是随 750ms 事件轮询产生约 133 次/秒。
- pg-boss 优雅停机等待 `max(2 × LLM_TIMEOUT_MS, AGENT_TIMEOUT_MS) + 30 秒`，默认 210 秒，配置上限下最大 630 秒；Compose `stop_grace_period=645s`，再留 15 秒容器余量。API Docker CMD 在 migration 后使用 `exec node`，使 Node 成为 PID 1 并直接接收 SIGTERM；Nest 已启用 shutdown hooks，因此正常发布不会在旧的 35 秒边界强杀付费请求。
- `DEMO_MODE` 先 trim/lowercase，只有明确的 `false` 加非空 API Key 才进入真实模式；生产中的 `ture/1/yes` 会拒绝启动，`TRUE` 安全归一为 Demo。

## 数据模型

`GenerationRun` 本次新增 `providerCallCount`、`providerDurationMs`，并开始可靠填充原有的 `promptTokens`、`completionTokens`：

- `providerCallCount`：该阶段 Run 的上游模型调用总数；演示生成器为 0。
- `providerDurationMs`：所有已记录上游调用耗时之和；没有上游调用时为 `null`。
- `promptTokens` / `completionTokens`：所有调用都报告 usage 时的合计。任一调用未报告相应 usage 时保持 `null`，避免把部分数据误当完整成本。

`GenerationProviderCall` 为每个调用保留：

- Run 内序号、是否请求结构化输出；
- 结果分类、是否适合由外层稍后重试、HTTP 状态；
- prompt/completion Token（供应商未返回时为 `null`）；
- 调用耗时。

调用明细在阶段完成事务中写入；阶段失败时，Run 标量更新和 `GenerationProviderCall.createMany` 在同一事务写入。两者任一失败都会一起回滚，且 `skipDuplicates` 以 `(runId, sequence)` 唯一约束支持安全重入。不会保存 API Key、Prompt、模型输出或供应商原始错误正文。

当前数据库保存 Token、调用次数和耗时，不直接存储货币金额。金额必须结合供应商与模型的版本化价格表在外部计算，并在供应商控制台设置独立的金额告警/硬限额；项目级日/月配额不能替代金额预算。

Migration 前已有 Run 的 `providerCallCount=0` 只是兼容性默认值，不代表历史上实际没有调用。旧数据缺少逐调用明细，历史成本无法恢复；审计必须按 telemetry migration 的部署时间切分，或只统计存在 `GenerationProviderCall` 的新 Run。

## 审计查询示例

```sql
SELECT
  r.id,
  r.stage,
  r.status,
  r."providerCallCount",
  r."providerDurationMs",
  r."promptTokens",
  r."completionTokens"
FROM "GenerationRun" r
ORDER BY r."startedAt" DESC
LIMIT 100;
```

```sql
SELECT
  c."runId",
  c.sequence,
  c.structured,
  c.outcome,
  c.retryable,
  c."httpStatus",
  c."promptTokens",
  c."completionTokens",
  c."durationMs"
FROM "GenerationProviderCall" c
WHERE c."runId" = '<run-id>'
ORDER BY c.sequence;
```

## 上线验证

2026-08-15 已在确认目标为本机 `localhost:5433/idea2screenplay` 后，对当前开发数据库应用 telemetry migration。迁移前临时逻辑备份可由 `pg_restore -l` 正常读取；迁移后 `prisma migrate status` 为 up to date，已完成迁移从 9 个变为 10 个，`GenerationRun` 保持 **78 → 78**，78 条历史 Run 的 `providerCallCount` 均为兼容默认值 0，新 `GenerationProviderCall` 表为 0 条。验证完成后临时备份已从开发数据库容器精确删除。生产 API 镜像仍会使用容器内的隔离连接自动执行 `prisma migrate deploy`。

1. 执行 Prisma migration 并确认旧 `GenerationRun.providerCallCount` 默认为 0。
2. 用真实供应商完成一个阶段，确认 Run 与一条 `success` 调用明细均有耗时；若供应商返回 usage，Token 应非空。
3. 用测试网关分别模拟 401、429、503、本地超时、断连、空响应和无效 JSON，确认每种情况都只有一次 HTTP 调用、失败 Run 有一条明细，且 Job 均不进入 `RETRYING`。
4. 模拟明确的 `response_format is not supported`，确认恰好两次调用，序号为 1/2，第二次不带 `response_format`。
5. 模拟模型成功后第一次结果事务抛 P2034：事务应调用两次、模型只调用一次；模拟语义无效输出或结果数据库不可用，Job 应进入 `FAILED` 而不是 `RETRYING`。
6. 对照供应商账单抽查 `GenerationProviderCall` 数量和 Token；未返回 usage 的调用只能按次数与耗时审计，不能推算为 0 Token。
7. 把供应商地址指向确定拒绝连接的端口并并发提交 100 个任务；最终应是 Job/Run 全部 `FAILED`、Project 全部 `REVIEWING`、Version 仍为 `STAGING` 且 `currentStage` 不前移。再人工构造“Job 已 FAILED、Run 仍 RUNNING”的旧残留，分别用 Job GET、SSE 和 project active-job GET 验证幂等修复；同项目已有新 active Job 时 Project 必须保持 `GENERATING`。

## 2026-08-14 至 2026-08-15 实测记录

- Prisma Client 生成和 schema validate 均通过；Nest API build 与 ESLint 通过。
- 随后把错误分类接入 pg-boss Worker，并增加供应商能力缓存；明确拒绝结构化输出后，后续请求不再重复探测 `response_format`。终审又加入 HTTP 200 语义无效、付费后事务冲突、结果持久化失败、本地 Timeout/Abort 和断连的费用回归；最新定向结果见本节末尾的最终回归记录。
- 在独立 `postgres:17-alpine` 空库执行 `prisma migrate deploy`，10 个 migration（含本次 migration）全部成功。
- 在该独立库写入一条失败 Run 和一条供应商调用明细后，实际查询结果为：`FAILED`、`providerCallCount=1`、`providerDurationMs=127`、`outcome=provider_unavailable`、`httpStatus=503`、调用耗时 `127ms`；供应商未提供 usage，因此 Run 与调用明细的 prompt/completion Token 均为 `NULL`，没有被错误记作 0。该记录是 migration 写入能力夹具，不作为最终重试策略断言；最终代码会把同类调用记录为 `retryable=false`。
- 在最终 no-cache 生产镜像、全新 PostgreSQL 17 数据库和拒绝连接的 loopback 模型地址上并发提交 100 个真实生成任务：`GenerationJob FAILED/attempt=1` **100/100**，`GenerationRun FAILED/providerCallCount=1` **100/100**，Project `REVIEWING/IDEA` **100/100**，Version `STAGING/IDEA` **100/100**，`GenerationProviderCall outcome=transport/retryable=false` **100/100**；Job/Run/Project/Version/Call 一致性 join 为 **100/100**。第 101 次生成被配额层以 HTTP 429 拒绝，数据库最终只有 101 个 Project、100 个 Job/Run/ProviderCall；日志中没有 Prisma relation nested-write 错误。
- 同一 PostgreSQL 17 环境又人工构造了 4 组历史残留。Job GET、project active-job GET 和 SSE 三组在修复前均为 `FAILED Job/eventSequence=4 + RUNNING Run + GENERATING/PREMISE Project`；读取后均保持 Job 序号为 4、不新增事件，Run 变为 `FAILED`，Project 变为 `REVIEWING/IDEA`。第四组同时存在新的 `QUEUED/CHARACTERS` Job，旧 FAILED Job 的 GET 只把旧 Run 修为 `FAILED`，Project 保持 `GENERATING/CHARACTERS`，新 Job 也保持原样。
- P1 冻结镜像曾同时打开 100 条 SSE：HTTP 100/100 为 200，建立 p95 **106.7 ms**，持续 **17.525 秒**后随 100 个任务完成而全部正常闭流，abort/error 均为 0；传输 93,800 bytes、540 chunks。跨过一次 15 秒对账窗口后 PostgreSQL commit 从 537 增至 5,825（+5,288，约 **302 次/秒**），rollback 仍为 0，连接后端从 6 增至 22。这组数据随后成为共享批量轮询优化的修复前基线；当前代码的 100 个不同 Job 黑盒已降至 **17.345 commits/s（-94.251%）**，完整证据见 [P2-SSE-DATABASE-LOAD.md](./P2-SSE-DATABASE-LOAD.md)。
- 最终镜像的 Node 已由 `/proc/1` 与 `docker top` 确认为 PID 1。本地假模型固定延迟 35 秒，在 Job/Run 为 RUNNING、Project 为 GENERATING 时执行 `docker stop --timeout 120`，容器等待 **35,451.2 ms** 后自行 exit 0、OOM=false；数据库最终为 Job SUCCEEDED、Run COMPLETED、Project REVIEWING/PREMISE、Version STAGING/PREMISE，并有且仅有 1 条 `success/httpStatus=200` ProviderCall。这验证停机预算和信号转发确实保护在途结果，而不仅是配置推算。
- 最终 API 全量回归为 **24 个 suite、203 个 case 全通过**；Prisma schema validate、Nest build 与 ESLint 均通过。测试确认：首次提交 P2034 时数据库事务执行 2 次而模型调用保持 1 次；语义无效与提交失败均不可重试；401/408/429/503、TimeoutError、AbortError、transport、空响应和无效 JSON 均不会自动发起第二个 Job attempt；前置项目写入或 `stage:start` 落盘首次失败后重投，模型调用均严格为 1 次；FAILED 重投、既有 Run 重投和失败事件落库失败都不会再次调用模型；两个同 `retryCount` 的并发投递只写 1 条 `job:running` 并只进入模型控制流 1 次，旧/新 retry overlap 只有精确 attempt 所有者创建 Run，硬崩溃留下的 `RUNNING` attempt 可由下一 retry 恢复，首次或非首次 claim 事务回滚后都能抛回 pg-boss 并由后续 retry 领取；旧 attempt 的迟到结果/错误不会修改新所有者的共享状态，模拟结果事务已提交但 COMMIT ACK 丢失时 Job/Run/Project 仍保持成功；既有 Run 检查与并发 `SUCCEEDED` 的交错不会反写终态；queue retry 旧快照不会降级新 attempt，completed 队列不会误杀刚领取或付费中的 attempt；失败 Run 的 `updateMany.data` 不含 relation nested write，ProviderCall 明细由同事务 `createMany` 落盘，cleanup 二次失败会记录日志并保留原错误；Job 失败事务、终态 Job GET、SSE 完成以及无 active Job 的 project GET 都能把残留 Run/Project 幂等修复，CAS 丢失或已有新 active Job 时不会覆盖新状态；SSE 在 active 队列上 15 秒内只额外查询 1 次；运行时测试确认过短的 60 秒 Job expiry 会按付费窗口提升为 240/660 秒；非法生产费用开关拒绝启动。
- 独立测试容器及其测试数据已在验证结束后删除，未改动开发数据库。
