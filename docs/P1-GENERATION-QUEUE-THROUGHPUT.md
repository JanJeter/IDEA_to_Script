# P1：生成队列吞吐修复

状态：已修复（2026-08-15）

## 问题与实测现象

生成队列启用了 pg-boss 的 `notify` 与实例级 `useListenNotify`。在这种模式下，worker 的空闲回退轮询由 `notifyPollingIntervalSeconds` 控制；未显式配置时默认是 30 秒，而原有的 `pollingIntervalSeconds: 1` 只在 NOTIFY 不可用时生效。

100 次顺序入队的隔离环境实测中，96 次成功入队，另 4 次因当时尚未修复的 Serializable P2034 返回 500。NOTIFY 唤醒结束后，积压任务的完成时间稳定落在约 30 秒间隔（例如 `10:55:19`、`10:55:49`、`10:56:19`、`10:56:49`），表现为每 30 秒才继续消费一个任务。

此外，生成队列使用 `policy: 'singleton'`，但入队没有 `singletonKey`，所有项目实际共享同一个 singleton 范围。即使提高 worker 并发，队列仍会全局串行。

## 修复

- worker 的 `localConcurrency` 读取 `GENERATION_CONCURRENCY`；服务端 fallback 为 1，允许范围 1–10，生产 Compose 默认值为 2。超出上限时按 10 处理，无效或小于 1 时回退为 1。
- 显式设置 `notifyPollingIntervalSeconds: 1`，把 NOTIFY 模式的积压回退轮询从默认 30 秒降至 1 秒。
- 设置 `burstWhenReadyExceeds: 1`，当 pg-boss 的 ready 统计发现积压时连续拉取。
- 保持 `batchSize` 默认值 1。当前回调一次处理一个任务，不通过批量抓取改变失败、心跳或重试语义。
- 保留现有 `singleton` 队列策略，但新任务使用 `projectId` 作为 `singletonKey`：同一项目仍严格串行，不同项目可由 `localConcurrency` 并行处理。
- 优雅停机按 `max(2 × LLM_TIMEOUT_MS, AGENT_TIMEOUT_MS) + 30 秒` 等待。Legacy 在供应商明确拒绝 `response_format` 时最多串行发出两次请求，Agent 的超时覆盖整个运行；默认等待 210 秒，允许配置下的最大值为 630 秒。生产 Compose 使用 `stop_grace_period: 645s`，给容器信号处理再留 15 秒余量。

这里不删除或重建队列，也不更改已存在队列的 policy，因而没有丢失在途任务的迁移风险。修复部署前已入队、且没有 key 的旧任务仍共享旧的 singleton 范围，但会受 1 秒回退轮询改善；`singletonKey` 只影响新入队任务。

## 配置与容量边界

`GENERATION_CONCURRENCY` 是每个 API 进程的 worker 并发，不是整个集群的全局上限。若部署 `R` 个 API 副本、每个设置为 `C`，队列最多可能同时派发约 `R × C` 个生成任务；上线前应按模型服务限额、数据库连接数和机器资源共同确定该值。

项目内的生成任务继续由 singleton key 串行化。应用层现有的每项目活动任务检查仍应保留，singleton key 是队列侧的第二道约束。

## 自动化验证

```powershell
npm run test -w @idea2screenplay/api -- generation-queue.service.spec.ts
npm run lint -w @idea2screenplay/api
npm run build -w @idea2screenplay/api
```

单元测试锁定以下契约：

1. pg-boss `work()` 收到配置后的 `localConcurrency`、1 秒 notify 回退和 backlog burst 配置。
2. 缺失、无效及过大的并发配置分别安全回退或截断。
3. `send()` 在原数据库事务中入队，并携带项目级 `singletonKey`。
4. pg-boss 停机等待同时覆盖两次 Legacy 模型请求或一次完整 Agent 运行；生产容器的 grace period 大于代码最大等待。

## 隔离环境负载验收

使用独立 PostgreSQL 数据库，开启 `DEMO_MODE=true` 与 `LOCAL_UNLIMITED_MODE=true`，不要连接开发或生产数据库。创建至少 20 个不同项目并同时入队，分别以 `GENERATION_CONCURRENCY=1`、`4` 做对照。

采集 `queuedAt → startedAt` 的 p50、p95、最大值，RUNNING 数量，单位时间完成数、失败数和重试数。验收条件：

- 积压期间不再出现约 30 秒一级的启动/完成阶梯；没有新 NOTIFY 时，worker 最迟约 1 秒进行一次回退抓取。
- 单 API 进程同时 RUNNING 的任务不超过配置值，且配置为 4 时可观察到不同 `projectId` 的任务重叠执行。
- 同一 `projectId` 的两个任务不能重叠执行。
- 失败和重试行为与修复前一致，不因批量抓取产生整批失败。

建议先在单副本、并发 2–4 的灰度环境观察模型服务的 429、超时和数据库连接占用，再决定是否提高到上限。回滚时只需把 `GENERATION_CONCURRENCY` 设回 1；本修复不需要数据库回滚。

### 当前生产默认值的先行实测

在生产 Compose 默认 `GENERATION_CONCURRENCY=2`、20 个不同项目、Demo 生成器和全新 PostgreSQL 17 下：challenge 20 × 200、authorize 20 × 201、enqueue 20 × 202，最终 **20/20 SUCCEEDED**；整批墙钟 **9.072 秒**，`queuedAt → startedAt` p50 **3.433 秒**、p95 **8.316 秒**、最大 **8.332 秒**，没有出现 25–35 秒启动间隔。数据库有 20 条 Run，`providerCallCount` 合计 0、provider-call 明细 0，证明没有外部模型调用。

### 最终并发 1/4 对照

最终 no-cache 生产镜像分别连接两套全新 PostgreSQL 17 数据库，以 Demo 生成器对 20 个不同项目同时入队；两组均为 access 20 × 201、create 20 × 201、challenge 20 × 200、authorize 20 × 201、enqueue 20 × 202，且 **20/20 SUCCEEDED、attempt=1**：

| `GENERATION_CONCURRENCY` | 整批墙钟 | `queuedAt → startedAt` p50 | p95 | 最大值 | 峰值 RUNNING | 最大相邻启动间隔 | 25–35 秒阶梯 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 19.035 s | 8.413 s | 17.318 s | 18.310 s | 1 | 1.010 s | 0 |
| 4 | 4.115 s | 1.414 s | 3.351 s | 3.376 s | 4 | 0.935 s | 0 |

并发 4 的墙钟相对并发 1 缩短约 **4.63 倍**。两组数据库的 Job、Run、Project、Version 终态全部一致，pg-boss 均为 completed；Demo 路径 ProviderCall 为 0，确认没有外部模型请求。该结果同时证明 singleton key 已按项目生效，而不是继续全局单工。

同一并发 4 环境扩展到 100 个项目后，又同时确认 PREMISE：HTTP **100 × 202**，409/500/503 均为 0，整批墙钟 **774.4 ms**、p95 **720.8 ms**。后续 CHARACTERS Job **100/100 SUCCEEDED、attempt=1**，Run 100 条 COMPLETED，Project 100 条 `REVIEWING/CHARACTERS`，pg-boss 100 条 completed，未发生阶段确认事务惊群或跨项目串行。

最终还用固定延迟 35 秒的本地假模型验证停机：Node 是 PID 1，在 Job/Run 已 RUNNING 后执行 `docker stop --timeout 120`，容器等待 **35.451 秒**完成上游响应与数据库提交后自行 exit 0；Job/Run/Project/Version 终态一致，未被强杀。该实测覆盖了停机等待公式的信号转发与真实控制流。
