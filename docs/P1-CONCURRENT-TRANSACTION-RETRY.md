# P1：Serializable 并发事务与生成入队

状态：已修复（2026-08-15）

## 结论

项目创建与生成入队的 P1 已修复。最终在全新 PostgreSQL 17 数据库、生产构建镜像和 100 个独立访客/IP 的同时请求下：

- 项目创建：`100 × HTTP 201`，`0 × 500/503`，p95 `1969.2 ms`；
- Demo 生成入队：`100 × HTTP 202`，`0 × 500/503`，p95 `2630.2 ms`；
- 数据库最终存在 `100` 个 Project、`100` 个 GenerationVersion、`100` 个 GenerationJob。

本测试不调用外部模型，不产生模型费用。

## 原问题与实测定位

修复前的生产式压测中，100 并发项目创建只有 12%～18% 成功；20 并发生成入队只有 2 个 202、18 个 500。Prisma 抛出 `P2034`，PostgreSQL 报告 `could not serialize access`。

第一版把 P2034 重试增至 8 次后，真实 HTTP 压测又发现 pg-boss 通过 Prisma raw-query adapter 执行 SQL。相同的 PostgreSQL `40001` 不会表现为 `P2034`，而是：

```text
Prisma code: P2010
meta.code: 40001
message: could not serialize access due to read/write dependencies among transactions
```

只识别 P2034 时，100 并发入队结果是 `43 × 202 / 56 × 500 / 1 × 503`。纳入 raw SQLSTATE 重试后，500 被消除，但无并发闸门时仍为 `83 × 202 / 17 × 503`；8 槽闸门为 `92 × 202 / 8 × 503`。最终采用单槽 FIFO 闸门后达到 `100 × 202`。

## 修复内容

### 1. 统一 Serializable 重试

`retrySerializableTransaction` 与同一 FIFO 闸门统一用于项目创建、初次生成入队、真实生成额度预占、阶段确认和阶段重生成入队：

- 最多 8 次完整事务尝试；
- 指数退避项从 10 ms 起步、500 ms 封顶；
- 每轮再叠加 0 至指数项减 1 ms 的随机 jitter，因此单次实际等待小于 1,000 ms，避免请求同步重撞；
- 识别 Prisma `P2034`；
- 同时识别 pg-boss raw SQL 的 `P2010 + SQLSTATE 40001/40P01`；
- 重试耗尽转换成 HTTP 503，不再泄漏为 HTTP 500。

生成服务还保留最后一道错误映射，即使下层意外传出上述错误，也只会返回 503。

模型结果返回后的 Serializable 提交也在模型调用外部只重试数据库事务，不会因提交冲突重新调用供应商。所有这些改动复用现有 schema，没有新增数据库 migration。

### 2. 有界、公平的事务闸门

单 API 实例内使用 FIFO 闸门，默认只执行 1 个 Serializable 写事务。槽位只覆盖一次 `$transaction` 尝试，退避等待不占槽，并在 `finally` 中释放。

默认与硬上限如下：

| 环境变量 | 默认值 | 最大值 |
| --- | ---: | ---: |
| `SERIALIZABLE_TRANSACTION_CONCURRENCY` | 1 | 32 |
| `SERIALIZABLE_TRANSACTION_QUEUE_LIMIT` | 256 | 2048 |
| `SERIALIZABLE_TRANSACTION_WAIT_TIMEOUT_MS` | 15000 | 60000 |

队列已满或等待超时返回明确的 HTTP 503，避免无界内存增长。生产当前是单 API 容器；如果以后水平扩容，仍须重新做多实例压测，因为闸门是进程内的。

### 3. 缩短事务窗口并保持原子性

- 每项额度由原来的 `upsert + updateMany` 两条 SQL，改为单条原子 `upsert increment + RETURNING`；超过额度时抛错并回滚，因此不会多扣额度；
- 初次入队移除重复的 active-job 预读，继续由数据库的 `GenerationJob_one_active_per_project` 唯一索引兜底；
- Job、Version 和 pg-boss 记录仍在同一事务中提交；
- 生成票据仍在进入事务前一次性删除。事务内部失败会整体回滚，重试执行完整回调，不会重复落盘，也不能重复使用票据。

### 4. 默认额度支持约 100 名受邀用户

服务端 fallback 调整为：

| 配置 | 默认值 |
| --- | ---: |
| `IP_PROJECTS_PER_DAY` | 200 |
| `VISITOR_GENERATIONS_PER_DAY` | 3 |
| `IP_GENERATIONS_PER_DAY` | 100 |
| `GLOBAL_GENERATIONS_PER_DAY` | 100 |
| `GLOBAL_GENERATIONS_PER_MONTH` | 3000 |

这些值仍受代码中的最大值约束。访问控制和邀请码用于阻止未受邀用户抢占额度，见对应 P1 文档。

## 最终压测数据

测试时间：2026-08-14。环境：单个 Node 24 生产构建 API 容器；全新 `postgres:17-alpine` 数据库；Demo 模式；Worker 并发 1；100 个不同 Cookie 和 `X-Forwarded-For` 地址。请求通过 `Promise.all` 同时发出；每个访客完整执行项目创建、ALTCHA challenge/authorize、生成入队。

| 阶段 | 状态码分布 | p50 | p95 | 最大值 | 整批墙钟时间 |
| --- | --- | ---: | ---: | ---: | ---: |
| 项目创建 | 100 × 201 | 1101.5 ms | 1969.2 ms | 2061.0 ms | 2089.9 ms |
| Challenge | 100 × 200 | 61.4 ms | 62.9 ms | 63.3 ms | — |
| Authorize | 100 × 201 | 78.2 ms | 83.1 ms | 85.9 ms | — |
| 生成入队 | 100 × 202 | 1446.1 ms | 2630.2 ms | 2774.7 ms | 2778.9 ms |

从最终 API 容器启动时刻起统计日志：

- API 日志字面量 `P2034`：0；
- API 日志字面量 `P2010`：0；
- Nest `ExceptionsHandler`：0；
- PostgreSQL `could not serialize access`：4 次；
- PostgreSQL deadlock：0 次。

PostgreSQL 的 4 次内部序列化中止均被应用/Job 重试吸收，没有影响 100 个创建或 100 个入队 HTTP 响应。API 另记录了 2 条 Worker 阶段事务冲突文本；它们属于队列消费重试，不是入队接口未捕获异常。

2026-08-15 又用最终 no-cache 镜像、全新 PostgreSQL 17 和并发 4 Demo worker 验证了此前未覆盖的阶段确认路径：100 个项目同时确认 PREMISE，响应为 **100 × 202**，409/500/503 均为 0，整批墙钟 **774.4 ms**、p95 **720.8 ms**；随后 100 个 CHARACTERS Job 全部 `SUCCEEDED/attempt=1`，Run 100 条 COMPLETED，Project 100 条 `REVIEWING/CHARACTERS`。这验证 `confirmStage` 与初次入队确实共用同一 FIFO/Serializable 重试边界。

## 验收命令

代码级验收：

```powershell
npm run test -w @idea2screenplay/api -- --runInBand src/security/abuse-protection.service.spec.ts src/generation/generation-jobs.service.spec.ts
npm run test -w @idea2screenplay/api -- --runInBand
npm run lint -w @idea2screenplay/api
npm run build -w @idea2screenplay/api
```

生产镜像与数据库验收：

```powershell
docker build --tag i2s-p1-tx-api:local --file apps/api/Dockerfile .
```

最终 API runtime 使用容器内隔离的 `DATABASE_URL` 自动执行 `prisma migrate deploy`。不要在没有先核对目标连接串时直接运行根目录的 `npm run db:deploy`，因为它会读取当前工作区环境并可能迁移错误的数据库。

启动全新 PostgreSQL 17 和生产 API 后，压测客户端应为每个虚拟用户保存独立 Cookie、使用独立 IP，并依次请求：

```text
POST /api/projects
GET  /api/projects/:id/generate/challenge
POST /api/projects/:id/generate/authorize
POST /api/projects/:id/generate/jobs
```

验收目标是项目创建 `100 × 201`、入队 `100 × 202`、`500 = 0`、`503 = 0`。数据库落盘可核对：

```sql
SELECT count(*) FROM "Project";
SELECT count(*) FROM "GenerationVersion";
SELECT count(*) FROM "GenerationJob";
```

单元测试还覆盖：8 次重试、指数退避+jitter、P2034、raw SQLSTATE 40001/40P01、非重试错误、FIFO 限流、异常释放、队列满、等待超时和配置上限。
