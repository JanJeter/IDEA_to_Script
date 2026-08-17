# P2：SSE 数据库轮询负载优化

状态：已修复并完成最终生产镜像黑盒复测（2026-08-15）

## 修复前的实际证据

最终 P1 生产镜像在全新 PostgreSQL 17 上同时打开 100 条生成任务 SSE：

- HTTP 100/100 为 200，建立 p95 106.7ms；
- 持续 17.525 秒后，100 条连接均随任务终态正常闭流，abort/error 为 0；
- PostgreSQL `xact_commit` 从 537 增至 5,825，即 **+5,288，约 302 commits/s**；
- rollback 为 0，数据库后端连接从 6 增至 22；
- API 约 0.27% CPU / 148.6MiB，PostgreSQL 约 4.29% CPU / 81.61MiB。

这组数据证明 100 条连接在测试机上功能稳定，但数据库读事务率明显偏高，不能直接外推为低配 VPS 的安全容量。

## 根因

旧实现为每个 SSE 订阅创建独立的 750ms 定时轮询。每轮至少执行：

1. 一次 `GenerationJob.findUnique`，读取任务状态和 `eventSequence`；
2. 一次 `GenerationJobEvent.findMany`，读取该连接游标之后的事件；
3. 非终态任务建立连接时立即查一次 pg-boss，此后每 15 秒再校准一次。

仅前两项在 100 条连接下的理论稳态就约为：

```text
100 connections × 2 queries ÷ 0.75s ≈ 267 queries/transactions per second
```

再叠加首次/15 秒队列校准、Worker 状态写入和其他请求后，与实测约 302 commits/s 相符。热点来自“每连接独立轮询”，不是 SSE 传输本身。

## 实现

`GenerationJobsService` 现在用一个进程内共享调度器服务所有 SSE 订阅：

- 仍以 750ms 为轮询周期，没有放大前端事件可见延迟；
- 每轮按 Job 去重，并以最多 200 个不同 Job 为一批；
- 一批只执行一次 `GenerationJob.findMany`，然后用一条带每 Job 精确游标条件的 `GenerationJobEvent.findMany` 回放增量事件；
- 同一 Job 有多个订阅时，每个订阅继续维护自己的 `afterSequence` 游标，不会漏发或重复推进其他连接；
- 每个非终态 Job 建连时仍立即执行 pg-boss 校准，此后最多每 15 秒一次；共享轮询不会取消该故障恢复边界；
- `FAILED` Job 在流结束前仍调用既有幂等一致性修复；queue completed/failed/cancelled 但业务状态残留时，仍补 `error` 事件并闭流；
- 终态只有在订阅游标追上 `eventSequence` 后才完成；不存在的 Job 仍直接完成；
- 心跳仍为 15 秒；最后一条订阅退出后会清除共享定时器，Nest 停机时会主动完成并清理所有流；
- 单批 Job 或 Event 查询失败时，受影响订阅以错误结束，由 EventSource 重连后从持久化游标回放，不把内存通知当作事实来源。

没有新增数据库表、migration、额外连接或外部消息系统。所有事件事实仍在 PostgreSQL，修改只合并读取调度。

## 查询量模型

目标场景为 100 条连接、100 个不同 Job，低于单批 200 上限：

| 项目 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 每个 750ms 周期的 Job 状态查询 | 100 | 1 |
| 每个 750ms 周期的 Event 增量查询 | 100 | 1 |
| 15 秒内第二轮前的 pg-boss 查询 | 100（首次） | 100（首次，语义不变） |
| 第二个 750ms 周期累计 Job/Event 查询 | 400 | 4 |

超过 200 个不同 Job 时按 `ceil(distinctJobs / 200)` 批次增长，避免生成无限大的 `IN`/`OR` 语句。多个连接订阅同一 Job 时会进一步去重。pg-boss 校准仍按“不同的活跃 Job”而不是批次数执行，因此最终实际 commits/s 必须由生产镜像黑盒复测，而不能只按表格推算。

## 自动化与隔离验证

定向命令：

```powershell
npm run test -w @idea2screenplay/api -- generation-jobs.service.spec.ts
npm run lint -w @idea2screenplay/api
npm run build -w @idea2screenplay/api
```

当前结果：

- `generation-jobs.service.spec.ts`：**42/42 通过**；
- API 全量：**24 suites / 205 tests 全通过**；
- API ESLint：通过；
- API production build：通过。

其中新增的 100 连接测试在同一事件循环内注册 100 个不同 Job，实际断言：

- 首轮只调用 1 次 Job 批量查询和 1 次 Event 批量查询；
- 首轮仍调用 100 次 pg-boss 校准；
- 750ms 后第二轮累计为 2 次 Job 查询和 2 次 Event 查询；
- 未满 15 秒时 pg-boss 查询仍保持 100 次，没有提前重复校准；
- 用 fake timer 精确推进到修复前黑盒相同的 17.525 秒后，累计 Job/Event 批量查询分别为 24/24，pg-boss 查询为 200；这对应 24 个轮询周期和 0/15 秒两轮校准。旧的每连接实现仅 Job/Event 两类查询在同样周期就会是 2,400/2,400。

另一项共享 Job 回放测试让两个订阅分别从序号 0 和 2 开始，在同一轮批量查询中分别实际收到 `[1,2,3]` 和 `[3]`，两条流都只在各自游标追上终态序号后完成。

既有回归同时锁定：持久事件按游标回放、终态事件后闭流、FAILED Run/Project 一致性修复、queue completed 残留修复并补错误事件、活跃队列最多每 15 秒查询一次。

这些测试全部使用 mock/隔离数据，没有调用真实或付费模型，也没有连接或迁移开发数据库。

## 最终生产镜像黑盒复测

最终 no-cache API 镜像连接全新 PostgreSQL 17，并使用仅存在于隔离 Docker 网络的本地假上游。`DEMO_MODE=false`，但模型地址从未离开测试网络，因而没有外部或付费调用。测试创建 100 个席位、100 个项目和 **100 个不同 Job**，模型端先 hold，确保全部 SSE 跨过 15 秒对账窗口，再统一释放并让连接自然闭流。

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| SSE HTTP 200 / 正常闭流 | 100/100 | **100/100** |
| 建立 p95 | 106.7ms | **84.4ms** |
| 连接异常 | 0 | **abort 0 / error 0** |
| 观察窗口 | 17.525s | **27.673s** |
| PostgreSQL commits 增量 | +5,288 | **+480** |
| PostgreSQL commits/s | 301.735/s | **17.345/s** |
| commits/s 降幅 | — | **94.251%（约 17.396 倍更少）** |
| rollback（观察窗口） | 0 | **0** |
| PostgreSQL 后端连接 | 6→22 | **20→20** |

100 条流的完整阶段墙钟为 **38.825 秒**；单连接持续时间 min/p50/p95/max 为 **30.495/33.516/38.037/38.792 秒**，全部超过 15 秒。总传输 100,120 bytes、560 chunks。修复前一轮是 100 条流订阅同一 Job；本轮使用 100 个不同 Job，因此没有依赖同 Job 去重制造较好结果。

离散资源采样（不是连续监控意义上的绝对峰值）：API 从 0.29% CPU/133.2MiB 到窗口内 0.62%/156.2MiB，终态采样最大为 **0.70%/164.3MiB**；PostgreSQL 从 3.39%/98.09MiB 到窗口内 3.72%/97.92MiB，终态采样最大为 **4.48%/108.3MiB**。API PID 保持 29，数据库 PID 为 26→25。

业务闭环也已核对：100 个 Job 全部 `SUCCEEDED/attempt=1/eventSequence=5`；Run 100 条 `COMPLETED/providerCallCount=1`；Project 100 条 `REVIEWING/PREMISE`；Version 100 条 `STAGING/PREMISE`；ProviderCall 100 条 `success/retryable=false/httpStatus=200`；五类事件各 100 条，每 Job 恰好序号 1–5；pg-boss 100 条 completed，一致性 join **100/100**。API 日志 ERROR/WARN 均为 0，负载后 readiness 仍为 200。

并发完成阶段最终累计出现 35 次 PostgreSQL rollback，但全部被现有 Serializable 重试吸收，100 个业务终态没有失败；表中的 15 秒以上活跃观察窗口 rollback 增量为 0。测试结束后，API、假上游、PostgreSQL 容器及专属卷、网络、镜像标签与临时 harness 均已精确清理，未触碰开发或生产数据库。

## 边界与后续

- 共享调度器是单 API 进程内的读取合并；多副本各自为本机连接建批次。多副本总负载仍随副本数增长，部署前需要重新压测。
- 本改动没有引入 PostgreSQL LISTEN/NOTIFY 或跨实例事件总线，因此即使进程内状态丢失，下一轮 750ms 数据库读取仍是持久化事实来源。
- 每 15 秒的 pg-boss 校准仍是每个不同活跃 Job 一次。若最终黑盒显示这部分成为下一热点，应优先为队列服务增加受支持的批量状态读取，不能依赖 pg-boss 未公开的分区表名。
- 200 是单条查询复杂度保护值，不是 SSE 连接上限。连接上限仍受反向代理、Node socket、PostgreSQL、API 副本数和部署机资源共同约束。
