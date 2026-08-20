# 100 人私测 P1 修复索引

> **历史索引：** 访问码准入已于 2026-08-20 被账号密码认证取代；此处保留旧版本审计与压测证据，不作为当前部署步骤。

状态：全部已修复并完成隔离实测（2026-08-15）

本索引是约 100 名受邀用户上线前的 P1 交付入口。每份文档都包含修复前实际证据、根因、代码/配置修复、修复后实际数据和仍需遵守的边界。

## P1 清单与最终证据

| P1 | 详细文档 | 最终隔离实测摘要 |
| --- | --- | --- |
| Serializable 冲突与并发入队 | [P1-CONCURRENT-TRANSACTION-RETRY.md](./P1-CONCURRENT-TRANSACTION-RETRY.md) | 100 并发创建为 100 × 201，100 并发初次入队为 100 × 202，500/503 均为 0；100 并发阶段确认也为 100 × 202，随后 Job 100/100 SUCCEEDED。 |
| pg-boss 30 秒阶梯与全局单工 | [P1-GENERATION-QUEUE-THROUGHPUT.md](./P1-GENERATION-QUEUE-THROUGHPUT.md) | 20 项目 C=1/C=4 均 20/20 SUCCEEDED；墙钟 19.035s → 4.115s，峰值 RUNNING 1 → 4，最大启动间隔 1.010s/0.935s，30 秒阶梯为 0。 |
| 100 席位准入、共享 NAT 与额度 | [P1-ACCESS-QUOTA-CONTROL.md](./P1-ACCESS-QUOTA-CONTROL.md) | 100 席位同 NAT 均成功授权、建项目和入队；第 101 次入队准确为 429，数据库日/月计数均恰好 100，无额外 Job/Run/ProviderCall。 |
| 健康探针访客泄漏与数据生命周期 | [P1-HEALTH-VISITOR-LIFECYCLE.md](./P1-HEALTH-VISITOR-LIFECYCLE.md) | health/ready 各 100/100 为 200 且 Set-Cookie=0、访客增量 0；真实 retention Job、失败残留修复和在途删除 409/终态删除 200 均通过。 |
| 模型无差别重试、重复费用与成本盲区 | [P1-LLM-RETRY-COST-TELEMETRY.md](./P1-LLM-RETRY-COST-TELEMETRY.md) | 拒绝连接的假上游 100 项：Job/Run/ProviderCall 各 100 条且一次 attempt 后一致失败；100/100 Run 记录 1 次调用，没有自动重放；历史残留 GET/SSE/getActive 修复 4 组均通过。 |
| Docker 构建秘密与停机信号 | [P1-DOCKER-BUILD-SECRET-ISOLATION.md](./P1-DOCKER-BUILD-SECRET-ISOLATION.md) | 最终 build/runtime 的 `.env*`、TLS 私钥和 dev.db/WAL 哨兵隔离通过；Node 为 PID 1，在途本地假模型任务下 stop 等待 35.451s 后自行 exit 0，未打满 120s。 |

## 最终统一回归

最终源码在 2026-08-15 独立复跑：

- `npm test`：API **24 suites / 203 tests**、Web **7 files / 29 tests**，全部通过；
- `npm run lint`：API 与 Web 均通过；
- `npm run build`：Nest 生产构建与 Vite 生产构建均通过；
- `npx prisma validate --schema=apps/api/prisma/schema.prisma`：通过；
- 带安全占位环境变量的 `docker compose -f docker-compose.prod.yml config --quiet`：exit 0；
- 最终 no-cache API 镜像在 fresh PostgreSQL 17 上自动执行全部 10 个 migration 并通过 ready 检查。

负载测试只使用 Demo 生成器、拒绝连接的 loopback 端点或本地假模型服务。没有连接生产数据库，没有调用付费模型，也没有把私有 `.env` 的值写入日志或文档。

## 上线前仍需由运维完成

以下是部署动作或已披露的产品边界，不是仍未修复的 P1：

1. 在可信终端生成 100 个访问码和彼此不同的随机生产密钥，写入服务器 `.env.production`；先运行 Compose `config --quiet`，再启动生产栈。不得复制 `.env.example` 中的公开开发密钥。
2. 全站日/月额度限制的是完整生成流水线数量，不是模型 HTTP 次数、Token 或人民币金额。必须在供应商控制台另设金额告警和硬限额，并用 `GenerationProviderCall` 对账。
3. 当前验收拓扑是单 API 实例。访问票据、错误码窗口和部分并发状态仍在进程内；增加 API 副本前必须迁移到共享存储并重新做多实例压测。
4. 本轮证明的是 100 人准入、事务、队列和故障一致性，不代表 15–30 分钟剧本质量已经验收。长剧本仍需单独做真实供应商质量/截断/成本评测。
5. pg-boss 本身没有 delivery token。代码已经通过 attempt fence、付费窗口、expiry 下限与幂等终态更新防止自动重复付费；极端长时间数据库/心跳故障最坏会把任务转为 FAILED 并要求人工重试，属于需监控的外部队列边界。
6. 如果修复前曾在带 `.env.production`、Certbot 私钥或 `dev.db*` 的工作区构建镜像，必须轮换相关密钥与访问码、替换/重新签发证书、清理旧缓存/镜像，并把 dev.db 内容按潜在数据泄漏处理。

当前开发数据库的 telemetry migration 已于 2026-08-15 安全应用：迁移 9 → 10，Run 78 → 78，历史 `providerCallCount=0` 为 78 条，新 ProviderCall 为 0 条，schema 状态为 up to date。

部署后的重点监控项是 HTTP 500/503、Serializable 重试耗尽、队列等待 p95、RUNNING 数、供应商 429/超时、Job/Run/Project 不一致数、每日/月度额度、ProviderCall/Token 与供应商账单差异、无项目访客增长和健康路由 `Set-Cookie` 数量。

P1 关闭后的 SSE 负载、备份恢复和容器硬化已继续完成，最新上线收口见 [P2-INDEX.md](./P2-INDEX.md)。
