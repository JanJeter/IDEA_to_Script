# AI 小说转剧本工具

把多章节小说快速转换为**结构化、可校验、可二次编辑**的 YAML 剧本初稿。

- 输入：3 章以上的小说文本（粘贴或载入示例）
- 输出：合法 YAML 剧本（人物 / 地点 / 时间线 / 分场 / 对白 / 动作 / 旁白 / 转场 / 改编说明 / 待确认项）
- 五步稳定管线，长文本分章处理，不一次性塞入模型
- **无需 API Key 即可运行**：自动进入 mock 模式，从你输入的小说真实抽取信息生成示例剧本
- 内置 JSON Schema 校验（ajv），一键校验输出是否合法

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. （可选）配置 AI。不配置则自动走 mock 模式
cp .env.example .env
#   在 .env 中填入 OPENAI_API_KEY 即可启用真实 AI 转换

# 3. 启动开发服务器
npm run dev
#   打开 http://localhost:3000
```
进入页面
![alt text](首页.png)
打开页面后：左侧点击「**载入示例**」→ 
![alt text](载入示例.png)

点击「**开始转换**」→ 右侧即出现 YAML 剧本，可复制 / 下载 / 校验。
![alt text](开始转换.png)

当然你也可以复制你自己的小说文本，粘贴到输入框，点击「**开始转换**」→ 右侧即出现 YAML 剧本，可复制 / 下载 / 校验。
---

## 不用启动也能验证

```bash
# 跑单元测试（章节解析、Schema 校验、mock 生成）
npm test

# 用独立脚本校验任意 YAML 剧本是否符合 Schema
npm run validate                                          # 校验 examples/sample-screenplay.yaml（应 PASS）
node scripts/validate.mjs examples/valid-example.yaml     # PASS
node scripts/validate.mjs examples/invalid-example.yaml   # FAIL（并列出错误原因）
```

---

## 工作原理（五步管线）

```
小说文本
  │
  ① 章节解析（确定性、正则，可单测）      lib/chapters.ts
  │   └─ 识别标题 / 拆分章节 / 保留原文 / 截取摘要；不足 3 章直接报错
  ② 章节级分析（AI / mock）              lib/ai.ts · lib/mock.ts
  ③ 人物 + 世界观汇总（AI / mock）
  ④ 分场剧本生成（逐章，AI / mock）
  ⑤ 组装 → Schema 校验 → 自动修复         lib/schema.ts · lib/pipeline.ts
  │
合法 YAML 剧本（lib/yaml.ts 由已校验对象序列化，永远合法）
```

**关键设计**：AI 各步只返回 JSON，由后端组装成对象后再序列化为 YAML，因此输出天然合法、可解析；同时保留 YAML 修复 / Schema 修复提示词作为兜底。

---

## 项目结构

```
aitransfer-script/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 三栏工具界面（输入 / 进度 / YAML 预览）
│   ├── layout.tsx
│   ├── globals.css               # 设计令牌与样式
│   └── api/
│       ├── convert/route.ts      # 流式转换接口（NDJSON 逐步进度）
│       ├── parse/route.ts        # 章节解析预览
│       ├── validate/route.ts     # YAML → Schema 校验
│       └── sample/route.ts       # 返回内置示例小说
├── lib/                          # 核心逻辑（与框架无关，可被测试直接引用）
│   ├── types.ts                  # 共享类型
│   ├── chapters.ts               # ① 章节解析（确定性）
│   ├── prompts.ts                # AI 提示词模板（6 套）
│   ├── ai.ts                     # OpenAI 调用 + mock 判定
│   ├── mock.ts                   # mock 模式：规则抽取生成剧本
│   ├── pipeline.ts               # 五步管线编排（异步事件流）
│   ├── schema.ts                 # ajv 加载 + 校验
│   └── yaml.ts                   # YAML 序列化 / 解析
├── schema/
│   └── screenplay.schema.json    # 剧本 JSON Schema（draft-07）
├── docs/
│   └── screenplay-yaml-schema.md # Schema 设计文档（字段说明 + 设计原因）
├── examples/
│   ├── sample-novel.txt          # 示例小说（3 章）
│   ├── sample-screenplay.yaml    # 转换后剧本示例（校验通过）
│   ├── valid-example.yaml        # 最小校验通过示例
│   └── invalid-example.yaml      # 校验失败示例（含失败原因注释）
├── scripts/
│   └── validate.mjs              # 独立 Schema 校验 CLI
├── tests/                        # vitest 单元测试
│   ├── chapters.test.ts
│   ├── schema.test.ts
│   └── mock.test.ts
├── .env.example                  # 环境变量示例（含 AI Key）
└── README.md
```

---

## 环境变量

见 `.env.example`：

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI（或兼容协议）Key。**留空则自动 mock 模式** |
| `OPENAI_BASE_URL` | 可选，自定义网关 / Azure / 国内兼容服务 |
| `OPENAI_MODEL` | 模型名，默认 `gpt-4o-mini` |
| `USE_MOCK` | 设为 `1` 强制 mock（即使配了 Key），便于演示 / 测试 |

---

## AI 提示词模板（`lib/prompts.ts`）

1. 章节分析　2. 人物提取　3. 世界观提取　4. 分场生成　5. YAML 修复　6. Schema 修复

统一约束：只输出合法 JSON/YAML、禁止 Markdown 包裹、保留原作关键信息、不凭空添加重大剧情、允许剧本化压缩改写、拿不准写入 `open_questions`。

---

## 如何继续扩展

- **接入更多模型**：`lib/ai.ts` 用的是 OpenAI Chat Completions 协议，配 `OPENAI_BASE_URL` 即可换国内兼容网关。
- **换载体（电影/电视剧/短剧/广播剧）**：传 `format`，并按 `docs/screenplay-yaml-schema.md` 第 6 节切换 `acts`/`episodes` 组织层。
- **细分场景**：在 `lib/prompts.ts` 的分场提示词里调整「一章拆几场」的策略。
- **导出 Fountain / PDF**：基于 `scenes[].elements` 的类型（dialogue/action/narration/transition）即可直接映射到标准剧本格式。
- **持久化与协作**：当前为无状态工具，可在 `app/api` 增加保存接口接数据库。

---

## 技术栈

Next.js 14（App Router）· TypeScript · ajv（JSON Schema 校验）· yaml · openai · vitest


