# 社会热点监听与 AIScript 转译

> 调研基线：2026-08-14（Asia/Shanghai）  
> 产品原则：热点是公开注意力信号，不是真实性证明，也不是可直接改编的新闻稿。

## 1. 已落地的工作流

```text
授权数据源
→ 规范化标题、排名、热度、时间与来源
→ 追加 TrendObservation 快照
→ LOW / REVIEW / BLOCKED 风险判断
→ 只提取服务端白名单内的抽象社会张力
→ AISCRIPT_TREND_BRIEF_V1
→ 仅 LOW 信号可建立 TREND_INSPIRED 项目
→ 沿用六阶段人工审阅流程生成短剧
```

热点原始标题、摘要、链接和现实实体只在“热点选题台”用于人工核对，不会进入模型的 `sourceText`。服务端先把输入映射为有限类别和安全张力轮廓，再让同类热点得到可区分的创作冲突；模型只收到抽象创作内核、观众问题和不可覆盖的虚构安全边界。

当前代码提供六个适配层：

- 默认启用 Wikimedia 中文站每日热门页，作为免费的“知识兴趣”弱信号；它不代表中国地区或社交平台热度。
- 配置 API Key 后启用百度千帆当前的“百度热搜”分类榜。
- 配置 Bearer Token 且确认开发者 use case 获批后启用 X API v2 官方地区趋势；默认只选美国、英国，其他官方 WOEID 必须显式配置。
- 通过双重开关启用 YouTube Data API v3 `mostPopular`，只把它称作热门音乐、电影、游戏的发现源。
- 取得微博商业数据授权后，可通过官方商业热搜榜接入微博；Access Token 和商业用途确认开关缺一不可。
- 可选接入一份已获授权、结构规范的 HTTPS JSON Feed；适配器限制响应体、拒绝重定向和私网地址，生产环境不能打开私网例外。

## 2. 外部来源调研结论

| 优先级 | 来源 | 结论 | 接入边界 |
|---|---|---|---|
| P0 | [百度千帆·百度热搜](https://cloud.baidu.com/doc/qianfan-api/s/Rmp2ixg31) | 已实现可选适配器；支持民生、财经、体育、文娱、国际、挑战、电影、电视剧、小说榜 | Bearer API Key；所有实际 HTTP 请求（跨 tab 和同 tab 重试）共享节流队列，相邻开始时间至少间隔 1.1 秒。当前[官方工具计费页](https://cloud.baidu.com/doc/qianfan/s/Umh4sv6gb)列出 ¥0.06/次、1 QPS 和每日免费额度，生产前应再次核价 |
| P0 | [X API v2 地区趋势](https://docs.x.com/x-api/trends/get-trends-by-woeid) | 已实现可选适配器；每个 WOEID 独立保存最近成功快照 | App-only Bearer Token；只保存趋势名、公开计数、地区和应用生成的搜索链接，不请求或保存 Post/账号。上线前须在 X use case 中申报“地区趋势聚合 → AI 辅助虚构创作”并获准 |
| P0 | [微博商业热搜榜](https://open.weibo.com/wiki/C/2/search/hot_word/biz) | 已实现、默认关闭；自然榜单项含排名和搜索热度 | 仅在商业数据合同书面覆盖快照留存、内部展示及 AI 辅助衍生创作后设置 `TRENDS_WEIBO_COMMERCIAL_APPROVED=true`；过滤 `id=0` 置顶项，不采集博文、账号或评论 |
| P1 | [YouTube Data API v3 `videos.list`](https://developers.google.com/youtube/v3/docs/videos/list) | 已实现、默认关闭的发现源；自 2025-07-21 起 `chart=mostPopular` 只汇集热门 Music、Movies、Gaming，不代表完整社会热榜 | 只请求 video ID、标题、categoryId、viewCount；不请求描述、频道或评论。跨源评分和抽象创作须先通过 YouTube 政策审阅，API 数据最迟 28 天清除或脱敏 |
| P1 | [微博官方 CLI](https://open.weibo.com/cli/index) | 可用于已登录账号的人工试点，不作为当前无人值守生产路径 | 命令目录和权益按账号动态下发；须先用 `commands list/show` 验证真实 schema，不调用 CLI 内部未文档化接口 |
| P0/P1 | [知乎数据开放平台](https://developer.zhihu.com/) | 推荐作为“公众问题与争议点”信号层，但开放仍受账号资格和合同约束 | 获得 Access Secret 后再实现；合同需明确 AI 辅助创作、保存期和署名要求 |
| P1 | 官方新闻/RSS | 用于事实线索和跨源核对，不等于转载授权 | 只保存标题、链接、发布时间和发布方；不入库正文、图片、音视频 |
| P2 | [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | 适合国际新闻覆盖与跨源佐证，不代表中国社交热度 | 约 15 分钟级数据，有限流；需要缓存和退避 |
| P2 | [Wikimedia Analytics API](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html) | 已实现；免费、免 Key、每日更新 | 必须使用可联系的 User-Agent；只作弱信号 |

Reddit 暂不实现。2026 年规则要求先注册并获明确批准，商业使用须另签合同，User Content 的许可也没有清楚覆盖 AI 衍生短剧；公共 API 还在迁移到 Developer Platform。没有书面授权前，不以 OAuth 可调用为由上线。

### 已下架接口

百度旧 `GET /v2/tools/trending_lists/medium` 文档虽然仍可能被搜索到，但[官方下架公告](https://cloud.baidu.com/doc/qianfan/s/Hmqgah69m)明确“热榜榜单查询”和“垂类热榜查询”已于 2026-06-18 下架，并要求迁移到“百度热搜”。仓库中没有保留该旧接口的生产路径。

### 抖音、B站、快手和小红书

[抖音开放平台权限调整公告](https://developer.open-douyin.com/forum/bulletin/post/672d828be9f6234d658c8dd2)显示，普通移动/网站应用的多项热点数据权限已经停止新增申请并回收存量权限。因此不能宣称本产品已通过公开 API 直连抖音热榜。B站、快手和小红书同样不应使用抓包接口、未授权爬虫或来源不明的数据代理。

可行路径是平台商务合作、白名单，或采购能提供书面授权链的舆情服务。签约前至少确认：API/Webhook、源平台授权证明、AI 衍生创作权限、保存期限、删除机制、图片与视频权利、SLA 与审计能力。

## 3. 数据与接口

核心表：

- `TrendTopic`：当前规范化信号、来源、风险、创作机会分和最后出现时间。
- `TrendObservation`：不可覆盖的排名、热度、动量和观测时间历史。
- `Project.trendTopicId`：短剧项目到原始信号的可追溯关系。

只保存列表级公开信息，不保存评论、用户账号、文章正文或媒体文件。外部 ID 在入库前统一 SHA-256；`BLOCKED` 信号会在入库前替换标题、摘要和链接路径。

不同来源的原始热度没有共同量纲。列表分数会先在各自来源内按排名或浏览量相对位置归一化，再合并排序。百度的每个 tab 与 X 的每个 WOEID 使用独立存储来源 ID；某个 tab/地区失败时继续展示它最近一次成功快照，并把聚合来源标为 `degraded`，不会用部分成功覆盖完整历史。

各来源独立判断抓取新鲜度：微博默认 5 分钟，X 默认 30 分钟，未声明专用周期的来源沿用全局 2 小时。新启用来源即使其他来源刚刚成功，也会独立完成首次抓取。

来源失败或部分地区降级时启用进程内指数退避：默认 5 分钟起步，连续失败逐次加倍、最高 1 小时。成功空榜仍记为一次成功尝试并遵守来源 TTL；公开列表和刷新按钮都不能绕过该闸门。多副本部署仍需把 `nextRetryAt` 持久化或放入共享租约。

公开接口：

```http
GET  /api/trends
POST /api/trends/refresh
GET  /api/trends/:id/brief
```

`GET /api/trends` 返回：

```json
{
  "items": [],
  "refreshedAt": "2026-08-14T00:00:00.000Z",
  "stale": false,
  "sources": [
    {
      "id": "wikimedia.zh.top",
      "label": "维基百科中文站每日热门",
      "status": "ok",
      "lastSuccessAt": "2026-08-14T00:00:00.000Z",
      "stale": false,
      "degraded": false
    }
  ]
}
```

`GET /api/trends/:id/brief` 返回来源展示信息、创作内核、安全规则和项目草案。`BLOCKED` 信号返回 HTTP 422；`REVIEW` 可以查看安全转译结果，但不能建立项目。

X 不返回语言码，YouTube 标题也可能跨语言。当前版本将这两个海外发现源统一标记为 `REVIEW`：可以监控、追溯和预览脱敏 AIScript Brief，但在加入可靠的多语言审核器与可审计人工批准记录前，不能直接创建短剧项目。微博中文商业热搜仍按通用 LOW/REVIEW/BLOCKED 规则处理。

## 4. AIScript 提示词契约

服务端生成的 `AISCRIPT_TREND_BRIEF_V1` 是项目的规范 `sourceText`。客户端可以修改标题、梗概、类型、语调和时长，但不能替换 `trendTopicId` 或安全提示词。

提示词要求所有六个阶段：

- 使用 2–5 个合成人物和虚构时空；
- 不出现现实人物姓名、账号、原话或可识别机构；
- 至少改变人物、地点、时间、因果链、视角和结局中的四项；
- 不复制标题措辞、正文表达、独特事件顺序或受保护角色世界；
- 不把热度、指控、伤亡或争议信息当作已核验事实；
- 前 10 秒出现可见钩子，高潮由主角付出代价的选择完成。

风险动作：

- `LOW / AUTO_APPROVE`：允许建立项目，仍需逐阶段人工确认。
- `REVIEW / REVIEW`：只允许查看提示词，项目创建接口会拒绝；在实现可审计的批准记录前不能自动生成。
- `BLOCKED / BLOCK`：未成年人、隐私或人肉信息不允许自动戏剧化。

项目创建事务、每一次生成任务入队、Worker 实际执行前、模型结果提交事务和 SCRIPT 最终激活都会重新读取当前 `TrendTopic.riskLevel`。因此，即使一个项目最初来自 LOW 信号，只要后续风险升为 REVIEW 或 BLOCKED，已排队任务、重试、结果提交和最终激活也会被服务端阻断。

## 5. 配置与调用成本

```dotenv
# 未声明专用周期来源的抓取下限；公开“刷新”按钮不能绕过各来源 TTL
TRENDS_FETCH_TTL_MS=7200000
TRENDS_STALE_AFTER_MS=21600000
TRENDS_REFRESH_INTERVAL_MS=300000
TRENDS_REFRESH_COOLDOWN_MS=60000
TRENDS_RETENTION_DAYS=14
TRENDS_SOURCE_TIMEOUT_MS=8000
TRENDS_SOURCE_FAILURE_BACKOFF_MS=300000
TRENDS_MAX_RESPONSE_BYTES=1048576
TRENDS_USER_AGENT="AIScriptTrendBot/0.1 (contact: you@example.com)"
TRENDS_WIKIMEDIA_LIMIT=24

# 可选：当前百度热搜
TRENDS_QIANFAN_API_KEY=
TRENDS_QIANFAN_BAIDU_TABS=livelihood,new_entertainment,finance
TRENDS_QIANFAN_LIMIT_PER_TAB=15

# 可选：X API v2 地区趋势（默认美国、英国）
TRENDS_X_BEARER_TOKEN=
TRENDS_X_USE_CASE_APPROVED=false
TRENDS_X_WOEIDS=23424977,23424975
TRENDS_X_FETCH_TTL_MS=1800000

# 可选：微博官方商业热搜榜；合同未确认时必须保持 false
TRENDS_WEIBO_APP_KEY=
TRENDS_WEIBO_ACCESS_TOKEN=
TRENDS_WEIBO_COMMERCIAL_APPROVED=false
TRENDS_WEIBO_COUNT=50
TRENDS_WEIBO_FETCH_TTL_MS=300000

# 可选：YouTube 热门音乐/电影/游戏发现源；政策审阅前保持 false
TRENDS_YOUTUBE_API_KEY=
TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED=false
TRENDS_YOUTUBE_REGIONS=US,GB
TRENDS_YOUTUBE_LIMIT_PER_REGION=20
TRENDS_YOUTUBE_FETCH_TTL_MS=3600000

# 可选：已获授权的标准化 Feed
TRENDS_JSON_FEED_URL=
TRENDS_JSON_FEED_LIMIT=30
TRENDS_ALLOW_PRIVATE_JSON_FEED=false
```

默认三张百度榜、每两小时一次，在持续运行时理论上每天最多 `3 × 12 = 36` 次榜单调用；具体账单以百度当期规则和免费额度为准。若未来缩短到 15 分钟，应先增加按来源的预算熔断、分布式刷新租约和调用量告警。

[X 官方按量价格](https://docs.x.com/x-api/getting-started/pricing)列出 Trends 为 `$0.010/次`；默认 2 个 WOEID、每 30 分钟一次，按 30 天持续运行约 `2 × 48 × 30 = 2,880` 次，即约 `$28.80/月`，未计失败重试或价格变化。适配器不在 429 内部重试，会读取 `x-rate-limit-reset` 建立本进程冷却窗口。微博商业热搜的单次 Credits/合同报价不公开硬编码，以上线账号的命令目录、合同和账单为准。YouTube `videos.list` 当前每次 1 quota unit，默认两地区每小时约 48 units/日；配额而非货币价格以 Google Cloud Console 为准。

微博优先使用商业合同/IP 授权的 `TRENDS_WEIBO_APP_KEY`（官方 `source` 参数）；只有合同要求 OAuth 时才使用 `TRENDS_WEIBO_ACCESS_TOKEN`，并在 Secret Manager 中轮换。该官方接口要求凭证作为查询参数，因此 APM、代理和出口日志必须删除 `source` / `access_token` 查询值。

YouTube API Key 同样是官方 `key` 查询参数；应在 Google Cloud 中把 Key 限制到 YouTube Data API v3 与服务器出口 IP，并从 URL/APM/代理日志中删除该参数。适配器自身的异常和来源状态不会回显完整 URL 或 Key。

当前生产拓扑是单 API 实例；进程内单航班、来源退避与数据库新鲜度检查足以防止同一实例的重复抓取。扩成多副本前必须增加数据库/Redis 分布式锁，并持久化来源尝试/退避状态，不能仅依赖“先查新鲜度再调用”的竞态窗口。

公开刷新使用每 IP 冷却和 1000 项硬上限，不能绕过数据库支持的抓取下限。14 天观察记录清理由独立定时任务执行，不依赖外部来源是否抓取成功。

### 上生产前仍需补齐

- 多 API 副本的 PostgreSQL advisory lock、pg-boss singleton 或 Redis 租约，避免重复付费调用。
- 对模型输出增加真人实体、原热点措辞重合及高风险内容的二次门禁；当前输入隔离和结构校验不能替代输出审核。
- 将授权 JSON Feed 限定到合同内域名，并在建连时绑定经过校验的解析结果，以进一步收紧 DNS rebinding 风险。
- 若要开放 REVIEW 题材，先增加 `reviewedAt`、审核人、策略版本和撤回记录；当前实现选择直接禁止生成。
- 对 X、微博增加每日调用量/费用硬熔断；当前只有各来源 TTL、429 退避和单进程单航班。
- YouTube 非授权 API 数据会在 28 天内删除；被项目引用的 Topic 只保留应用自有的通用占位记录和风险状态，不保留 video ID 哈希、标题、观看链接、播放量或派生分数。

## 6. 上线合规清单

- 数据合同允许当前用途，且记录来源、采集时间、许可说明和删除路径。
- X Developer use case 与微博商业数据合同必须明确允许“聚合趋势用于内部选题，并转成不含平台原文/用户数据的虚构创作提示”；拿到 Token 本身不等于获得这项用途授权。
- 事实型叙事至少两条独立来源、其中一条权威来源；辟谣命中直接阻断。
- 榜单、RSS 和搜索结果不等于正文、图片、音乐或视频的转载权。
- 面向中国境内公众提供服务时，核对[《生成式人工智能服务管理暂行办法》](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)的适用义务。
- 自 2025-09-01 起，按[《人工智能生成合成内容标识办法》](https://www.cac.gov.cn/2025-03/14/c_1743654685899683.htm)实现显式和隐式标识，不允许删除或篡改标识。
- 公开发行微短剧前按[广电总局微短剧管理通知](https://www.nrta.gov.cn/art/2025/2/5/art_113_70148.html)完成适用的审核备案；本工具生成的是编剧草稿，不是自动发布系统。
