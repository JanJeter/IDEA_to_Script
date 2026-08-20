# 100 人私测 P2 上线收口索引

> **历史索引：** 文中的访问码/匿名身份操作已于 2026-08-20 被账号密码认证取代；当前部署请以 `IP_DEPLOYMENT.md` 为准。

状态：三项必须在私测前完成的 P2 已实施并完成隔离实测（2026-08-15）

本轮在全部 P1 关闭后，继续处理最终压测和部署审计暴露的三个高价值 P2。所有模型链路均使用 Demo 或 Docker 内本地假上游，没有外部或付费调用。

## 交付与实际结果

| P2 | 详细文档 | 最终实测摘要 |
| --- | --- | --- |
| SSE 数据库轮询负载 | [P2-SSE-DATABASE-LOAD.md](./P2-SSE-DATABASE-LOAD.md) | 100 个不同 Job/100 SSE 全部正常闭流；活跃窗口从旧版 301.735 commits/s 降至 **17.345 commits/s**，下降 **94.251%**、约 17.396 倍；Job/Run/Project/Version/ProviderCall 一致性 100/100。 |
| PostgreSQL 备份、恢复和迁移前门禁 | [P2-DATABASE-BACKUP-RESTORE.md](./P2-DATABASE-BACKUP-RESTORE.md) | fresh PG17.10 完成真实 dump→fresh restore；10/10 migrations、22/22 外键、核心计数一致，DB ready 和隔离 API ready 均通过；生产项目、缺确认、非空目标和篡改 dump 均 fail-closed。 |
| 容器最小权限、依赖和日志边界 | [P2-CONTAINER-HARDENING.md](./P2-CONTAINER-HARDENING.md) | API 以 UID/GID 1000 运行，根文件系统只读、CapEff=0、NoNewPrivs=1、PID 上限 128；四服务日志 10MiB×3；镜像列表大小 1.17GB→801MB，node_modules 646MB→342MB；fresh migration/ready/Demo/Agent Skill/Web/SIGTERM 全通过。 |

当前开发数据库的 telemetry migration 也已安全应用：迁移数 **9→10**、GenerationRun **78→78**、历史 `providerCallCount=0` 为 78 条、新 ProviderCall 为 0 条，`prisma migrate status` 为 up to date。迁移前临时逻辑备份验证可读，迁移成功后已精确删除。

## 最终统一回归

- API：**24 suites / 205 tests** 全部通过；
- Web：**7 files / 29 tests** 全部通过；
- 全仓 lint、Nest/Vite production build、Prisma validate、`npm ls --depth=0`：exit 0；
- production Compose、production+bootstrap、restore+api profile 三套 `config --quiet`：exit 0；
- 最终 SSE no-cache 镜像在 fresh PostgreSQL 17 应用全部 10 个 migration，负载后 readiness 仍为 200，API 日志 ERROR/WARN 均为 0；
- 所有 `ids-p1*`、`ids-p2*` 测试容器、卷、网络、镜像、helper、fixture、harness 与假秘密均已精确清理，复查数量为 0。

## 上线时仍需人工执行

这些是服务器与供应商侧动作，不是仍未修复的代码问题：

1. 在目标 VPS 生成正式 `.env.production`、100 个访问码和互不相同的随机密钥；当前运行中的本机 prod 容器没有被本轮替换。
2. 先安装 root-only 备份目录和每日 cron，手动完成一次目标机备份；以后每次 `up -d` 前必须由备份成功作为 `&&` 硬门禁。
3. 每月在隔离卷执行一次完整恢复和 API ready 验证；同机 7 份备份不防整机磁盘损坏，稳定后应增加加密异地副本。
4. 在模型供应商控制台设置金额告警/硬限额；流水线额度不是 Token 或金额上限。
5. 在目标 VPS 监控磁盘、容器日志、PostgreSQL commits/连接/锁等待、队列 p95、PID 和内存。当前未设置 CPU 限额，需要目标机压测数据后再定。
6. 15–30 分钟长剧本仍需独立的真实模型质量、截断与成本验收；本轮没有为获取该数据产生费用。

部署顺序和命令见 [IP_DEPLOYMENT.md](./IP_DEPLOYMENT.md)。P1 的完整修复证据仍由 [P1-INDEX.md](./P1-INDEX.md) 维护。
