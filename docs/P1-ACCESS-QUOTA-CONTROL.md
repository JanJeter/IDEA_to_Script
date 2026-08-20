# P1：100 人私测准入与生产额度

状态：已修复（2026-08-15）

## 问题与修复前证据

生产配置原本没有登录、邀请码或白名单，任何公网访客都能抢占全站生成额度。同时默认额度与“100 人私测”直接冲突：

- 同一 IP 的 100 个新访客顺序创建项目，实测为 **20 个 201 + 80 个 429**。
- 100 个独立访客/IP 顺序申请真实生成，实测为 **8 个 202 + 92 个 429**，瓶颈是全站每日 8 次。
- 每月全站上限只有 100 次，无法支持一个 100 人席位池持续试用。

这不是机器性能不足，而是准入缺失和生产默认值错误；单纯调高额度会把模型费用暴露给所有公网访问者。

## 已实施的修复

### 1. 访问码门禁

- 生产 Compose 强制 `ACCESS_CONTROL_REQUIRED=true`，缺少 `APP_ACCESS_CODES` 时配置解析即失败。
- `GET /api/access/session` 只读取签名 Cookie，不创建访客记录。
- `POST /api/access/authorize` 校验访问码，并为每个 `IDS-001` 席位确定性派生一个匿名身份；同一席位跨设备、换码后仍访问同一项目库。
- 除所有 CORS 预检 `OPTIONS` 外，只精确排除三个准入端点和三个健康端点；其他 API 在未授权时返回 401，未来新增的 `/access/*` 管理端点不会自动公开。
- 授权请求必须为 JSON，同时携带同源 `Origin/Referer` 和浏览器无法用普通表单伪造的 `X-IDS-Access` 请求头，防止 login CSRF 把受害者切换到攻击者席位。
- 错误访问码按 IP 限制为 10 分钟内 5 次；第 6 个错误码返回 429。有效码会先完成验证，因此同一 NAT 下他人的误码不会锁死有效席位。
- 访问码只存在于部署环境变量中，不写数据库、不出现在日志中；Cookie 使用 HMAC 签名、`HttpOnly`、`SameSite=Lax`，生产启用 `Secure`。
- `VISITOR_IDENTITY_KEY` 只负责席位与数据库身份，Cookie 使用独立的 current/previous 签名密钥环；轮换 Cookie 密钥不会改变项目所有权，旧 Cookie 会在首次受保护请求时自动刷新。
- Web 增加了访问码页面、加载态、错误态、显示/隐藏码、键盘焦点和移动端布局；完整示例仍可无 API 预览。
- API 客户端保留 HTTP 状态。会话 401 会立刻回到门禁；SSE 兜底轮询遇到 401/403/404 会停止，网络/5xx 使用最高 30 秒的指数退避，不再每 1.5 秒无限打数据库。

访问码等同于一个席位的凭据，必须一人一码。多人共享同一码会共享项目和个人额度，因此不能把一个公共码发给 100 人。

### 2. 100 席位默认额度

生产默认值调整为：

| 配置 | 修复前 | 修复后 | 作用 |
| --- | ---: | ---: | --- |
| `IP_PROJECTS_PER_DAY` | 20 | 200 | 公司、校园或家庭 NAT 下也能创建项目 |
| `VISITOR_GENERATIONS_PER_DAY` | 1 | 3 | 单席位日生成上限 |
| `IP_GENERATIONS_PER_DAY` | 3 | 100 | 100 人共用出口 IP 时不被前三人耗尽 |
| `GLOBAL_GENERATIONS_PER_DAY` | 8 | 100 | 全站每日完整生成流水线准入上限 |
| `GLOBAL_GENERATIONS_PER_MONTH` | 100 | 3000 | 完整生成流水线的月度准入上限 |
| `GENERATION_CONCURRENCY` | 1 | 2 | 服务端 fallback 为 1；生产 Compose 默认两个 worker |

这些是完整流水线的硬准入上限，不是模型调用数、Token 或金额上限，也不是每人保证额度。一个项目通常包含 6 个阶段，重生成和首次 `response_format` 兼容降级还会增加调用；因此必须同时在模型供应商控制台配置金额告警/硬限额，并依据 `GenerationProviderCall` 审计实际调用。100 人在同一天各发起一次可以通过；若少数用户一天生成三次，全站第 101 条新流水线仍会被 429 拒绝。

## 生成并部署 100 个访问码

在可信的管理终端运行：

```bash
npm run access-codes:generate -- 100
```

命令输出一行 `APP_ACCESS_CODES=...`，将它写入服务器的 `.env.production`，不要提交到版本库，也不要烘焙进 Docker 镜像或构建缓存；构建上下文隔离见 `P1-DOCKER-BUILD-SECRET-ISOLATION.md`。把 `IDS-001-...` 到 `IDS-100-...` 分别通过私密渠道交给对应用户。每个生产码至少 12 个字符且不可重复。重复部署必须保留 `VISITOR_IDENTITY_KEY`；它一旦改变，所有席位都会成为新身份。

Cookie 签名密钥可以安全轮换：把旧 `COOKIE_SIGNING_KEY` 移到 `COOKIE_SIGNING_KEY_PREVIOUS`，生成新的 current key，保持 `VISITOR_IDENTITY_KEY` 不变；至少保留 previous 30 天。轮换某个泄漏的访问码时，生成仍以相同 `IDS-001-` 开头的新随机后缀并替换旧码。会话凭据与稳定席位身份是分离的：旧码签发的 Cookie 会立即变成 401，新码重新授权后仍解析到原 `AnonymousVisitor` 和原项目。

配置检查：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

旧访问码从列表移除并重启 API 后，旧码和它签发的全部 Cookie 都立即失效。当前 100 人私测门禁按“席位码”整体撤销，不区分同一席位的单台设备；若只想踢出其中一台设备，正式账户系统仍需单独的会话撤销表。

首次从无门禁版本升级时，旧随机匿名 Cookie 不会自动映射到访问码席位，已有项目也不会自动转移；如需保留，必须在上线前单独设计 `visitorId` 映射。本 P1 复用现有访客表结构，不新增 Prisma schema migration。

## 自动化与回归验收

已增加并通过以下契约测试：

- 有效访问码派生稳定身份，授权时创建/解析访客。
- 空 Cookie 在门禁开启时被中间件以 401 拒绝。
- 连续 5 次错误码返回 401，第 6 次返回 429。
- 同一 NAT 已有 5 次误码时，有效席位仍可授权。
- 恶意 Origin、HTML 表单类型或缺少自定义请求头时授权为 403，且不设置 Cookie。
- 只轮换 Cookie signer 时数据库 `tokenHash` 保持一致，previous 签名的旧 Cookie 被刷新；轮换席位码时旧会话失效，新会话仍解析为同一 `tokenHash`。
- 前端不提交空码、去除首尾空格、呈现后端错误，并允许打开示例。
- 前端受保护请求的 401 会广播会话失效，生成轮询对终止性 4xx 只请求一次。
- `docker compose config` 要求生产必须提供访问码。

隔离生产镜像已完成以下实测（PostgreSQL 17、单 API 容器、100 个新席位码、同一个模拟 NAT）：

- 未授权 `/api/projects`：401，且无 `Set-Cookie`；恶意 Origin 的 JSON 和正确 Origin 的 form 请求均为 403。
- 同一 IP 连续 5 个错误码均为 401，随后有效码仍为 201 并签发 Cookie，没有发生共享 NAT 登录锁死。
- 100 个访问码并发授权：**100 × 201**、100 个 `Set-Cookie`，p95 **110.4 ms**；数据库新增 100 个独立访客。
- 同 NAT 并发创建 100 个项目：**100 × 201**、0 × 429/500/503，墙钟 **781 ms**，p50 **423 ms**，p95 **736.4 ms**，最大 **774.9 ms**；`DailyIpQuota.projectsCreated=100`。
- 只轮换 Cookie signer 时，旧 Cookie 读取原项目为 200 并刷新为新 signer；同席位换码后旧会话为 401，新码授权为 201，新 Cookie 读取原项目为 200，访客总数没有增加。

最终 no-cache 生产镜像又在全新 PostgreSQL 17 数据库上完成了第 100/101 条额度边界实测。模型地址指向确定拒绝连接的 loopback 端口，API Key 为假值，因而没有连接真实供应商：

- 100 个席位均为授权 **201**、项目创建 **201**、challenge **200**、生成授权 **201**、入队 **202**；入队整批墙钟 **1,398.8 ms**、p95 **1,322.2 ms**，HTTP 500/503 均为 0。
- 第 101 个项目的 challenge 为 200、生成授权为 201，但同 NAT 的入队先命中 `IP_GENERATIONS_PER_DAY=100`，准确拒绝为 **429**；该事务整体回滚，因而全站日/月计数仍保持 100，也没有创建额外的 Job、Run 或 ProviderCall。
- 数据库最终为：`DailyIpQuota.projectsCreated=101`、`realGenerations=100`；100 条访客额度记录的生成次数总和为 100，最小值和最大值均为 1；全站日/月计数均为 100；Job、Run、ProviderCall 均恰好 100 条。
- 100 个 loopback transport 失败均在第一次 attempt 终止，Job/Run/Project/Version/ProviderCall 的一致性 join 为 **100/100**，证明额度通过不等于偷偷重试或额外扣费。

日/月键继续按中国标准时间（UTC+8）计算，并由自动化测试锁定。所有额度负载都使用隔离数据库和假上游，未连接生产数据库或付费模型。

## 回滚与边界

- 生产进程对门禁采用 fail-closed：`ACCESS_CONTROL_REQUIRED` 不是 true、身份密钥缺失、使用公开开发密钥（比较前会去除首尾空白）或没有访问码都会拒绝启动。需要公开演示时使用静态 `/workspace/sample`，不要关闭生产 API 门禁。
- 缩减费用：优先下调全站日/月上限，不必撤销用户访问码。
- 当前门禁是 100 人私测方案，不是完整账户系统：没有找回、成员管理、审计后台或项目转移。正式商业化前应迁移到具备账号生命周期和 MFA 的认证系统。
- 误码窗口、ALTCHA challenge、一次性票据和并发槽位是单 API 进程内状态；当前生产拓扑只有一个 API 容器，因此验收成立。扩展为多个 API 副本前，必须先把这些状态迁移到共享存储并重新压测，不能直接在负载均衡器后复制现有容器。
