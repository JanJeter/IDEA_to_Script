# 剧本 YAML Schema 设计文档

> 本文定义 **AI 小说转剧本工具** 的输出格式，并逐字段说明**为什么这样设计**。
>
> - 机器可读定义：[`schema/screenplay.schema.json`](../schema/screenplay.schema.json)（JSON Schema draft-07）
> - TypeScript 类型（与本文一一对应）：[`lib/types.ts`](../lib/types.ts)
> - 合法 / 非法样例：[`examples/valid-example.yaml`](../examples/valid-example.yaml) · [`examples/invalid-example.yaml`](../examples/invalid-example.yaml) · [`examples/sample-screenplay.yaml`](../examples/sample-screenplay.yaml)
> - 命令行校验：`node scripts/validate.mjs <file.yaml>`

---

## 1. 一句话总览

剧本是一个 **YAML 文档**，顶层为一个对象，包含 9 个区块：

```
metadata · source · characters · locations · timeline ·
(acts | episodes) · scenes · adaptation_notes · open_questions
```

其中 `scenes` 是核心；对白 / 动作 / 旁白 / 转场作为**有类型的 `elements` 条目**内联在每一场里。剧本的所有“可演内容”都由 `scenes[].elements` 承载，其余区块是为了**可回溯、可审阅、可二次编辑**而存在的结构化元数据。

---

## 2. 设计目标

工具的定位是“给小说作者一份**可编辑、可打磨的剧本初稿**”，而不是一份只能看的成品。Schema 因此围绕五个目标设计：

| # | 目标 | 在 Schema 中的体现 |
|---|------|--------------------|
| **G1** | **结构化** —— 让下游程序（编辑器、导出器、校对）能稳定消费 | 一切信息进入命名字段，而非自由文本段落 |
| **G2** | **可校验** —— 输出必须能被机器判定“合法 / 非法” | 用 JSON Schema 约束类型、枚举、必填、ID 格式 |
| **G3** | **可回溯** —— 每一场戏、每一个人物都能定位回原文 | `source`、`source_refs`、`evidence`（章节 + 段落 + 摘录） |
| **G4** | **可审阅改编** —— AI 改了什么，作者一眼可见、可推翻 | `adaptation`（每场）、`adaptation_notes`（全局）、`open_questions` |
| **G5** | **可扩展** —— 不同载体（电影/剧集/短剧）、未来字段不破坏旧数据 | `acts`/`episodes` 双轨、`additionalProperties: true` |

---

## 3. 为什么用「JSON Schema 描述 + YAML 序列化」

这是本项目两个关键取舍，直接决定了输出为何**天然合法**。

**为什么最终产物是 YAML，而不是 JSON？**
剧本初稿要交到**人**手里反复打磨。YAML 对中文友好、无需引号和大量括号、支持注释、缩进即层级，比 JSON 更接近“能直接读和改的稿子”。作者可以在 YAML 里手动调一句台词、加一条 `open_questions`，再喂回校验器。

**那为什么用 JSON Schema 来定义它？**
YAML 与 JSON 是同构的（YAML 是 JSON 超集）。我们用生态最成熟的 **JSON Schema（draft-07）** 描述结构，配合 [`ajv`](../lib/schema.ts) 做校验：YAML 先解析为对象，再按同一套 Schema 校验。一套定义，两种形态。

**输出为什么不会是“坏 YAML”？**
关键架构决策（见 [`lib/pipeline.ts`](../lib/pipeline.ts)）：**AI 各步只返回 JSON 片段，由后端组装成对象、Schema 校验/修复后，再用 [`lib/yaml.ts`](../lib/yaml.ts) 序列化为 YAML。** 序列化由库完成，因此输出**永远是合法、可解析的 YAML**；模型从不直接“手写” YAML。即便如此，仍保留了 YAML 修复 / Schema 修复提示词作为兜底。

---

## 4. 顶层结构

```yaml
metadata: { ... }          # 必填 · 剧本元信息
source:   { ... }          # 必填 · 原作来源与溯源锚点
characters: [ ... ]        # 必填 · 人物表
locations:  [ ... ]        # 必填 · 地点表
timeline:   [ ... ]        # 必填 · 时间线
acts:      [ ... ]         # 可选 · 分幕（电影/舞台）
episodes:  [ ... ]         # 可选 · 分集（剧集/短剧）
scenes:     [ ... ]        # 必填 · 分场（核心）
adaptation_notes: [ ... ]  # 可选 · 全局改编说明
open_questions:   [ ... ]  # 可选 · 待作者确认项
```

**必填顶层字段**：`metadata`、`source`、`characters`、`locations`、`timeline`、`scenes`。
**设计原因**：这六项是“一份剧本之所以成立”的最小集合——有元信息、有来源、有人、有地、有时间、有戏。分幕/分集是**组织视角**而非内容本身，改编说明与待确认项是**增益信息**，故均为可选，缺失不影响剧本可用。

---

## 5. 逐区块字段说明与设计原因

### 5.1 `metadata` —— 剧本元信息（必填）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `title` | string(≥1) | ✓ | 剧本标题 |
| `format` | enum | ✓ | `film` / `tv` / `short` / `stage` / `radio` / `drama` |
| `language` | string | ✓ | 语言码，如 `zh-CN` |
| `logline` | string | | 一句话故事梗概 |
| `genre` | string[] | | 题材标签，如 `[武侠, 悬疑]` |
| `created_at` | string | | 生成时间（ISO 8601） |
| `generator` | string | | 生成工具与版本，便于追责与复现 |

**设计原因**：`format` 用**封闭枚举**而非自由字符串，因为载体直接决定了组织层用 `acts` 还是 `episodes`、以及后续导出格式；枚举能让下游用 `switch` 稳定分支。`logline`/`genre` 选填——它们对人有用、对机器非必需，AI 拿不准时可省略而非编造。

---

### 5.2 `source` —— 原作来源（必填）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `novel_title` | string | ✓ | 原小说标题（未知填“未命名小说”） |
| `chapter_count` | integer **≥ 3** | ✓ | 识别到的章节数 |
| `author` | string | | 原作者 |
| `total_length` | integer ≥ 0 | | 原文字符总数 |
| `source_chapters` | object[] | | 章节索引表：`{ index, title, summary }` |

**设计原因**：
- **`chapter_count` 的 `minimum: 3` 是把赛题“3 个章节以上”写进了 Schema。** 不达标的输入根本生成不出合法剧本——约束前移到数据层，而不是埋在代码注释里。校验器会直接报 `chapter_count must be >= 3`（见 [`invalid-example.yaml`](../examples/invalid-example.yaml) 错误 1）。
- `source` 区块整体服务于 **G3 可回溯 / 版权追踪**：剧本脱离原著后仍带着“它从哪来”。`source_chapters` 只存**标题 + 摘要**而非整章原文，避免剧本文件膨胀，同时够用来定位。

---

### 5.3 `characters` —— 人物表（必填）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string `^char_[a-zA-Z0-9_]+$` | ✓ | 稳定引用 ID |
| `name` | string(≥1) | ✓ | 人物名 |
| `aliases` | string[] | | 别名 / 称谓（如“青衣男子”） |
| `role` | enum | | `protagonist`/`antagonist`/`supporting`/`minor`/`narrator`/`unknown` |
| `description` | string | | 人物简介 |
| `traits` | string[] | | 性格特质 |
| `arc` | string | | 人物弧光 / 成长线 |
| `evidence` | SourceRef[] | | **坐实证据**：该人物关键出现的原文段落 |
| `confidence` | enum | | `high`/`medium`/`low`：AI 对“别名归一”的把握 |

**设计原因**：
- **`id` 强制 `char_` 前缀正则**，是整个 Schema 的“引用骨架”。场景的 `elements[].character_id`、`scenes[].characters`、`timeline` 等都靠 ID 互指。统一前缀让“这是个人物引用”在任何位置都自解释，也便于人工排错（见 [`invalid-example.yaml`](../examples/invalid-example.yaml) 错误 2：`id: c1` 被拒）。
- **`aliases` + `confidence` + `evidence` 三件套解决小说改编的核心难题——人物归一。** 同一人物在原文常有多种称谓（本名 / 绰号 / “那青衣男子”）。AI 把它们合并为一个 `id`，但合并可能出错，于是：`aliases` 记录合并了哪些称谓，`confidence` 标注把握程度，`evidence` 给出原文出处让作者复核。这正是 **G4** 在人物维度的落地。
- `role` 用枚举，便于按戏剧功能着色 / 排序 / 统计。

> `evidence` 的元素结构与 5.7 的 `source_refs` 相同（`SourceReference`）：`chapter_index` / `chapter_title?` / `paragraph_start` / `paragraph_end` / `excerpt`。

---

### 5.4 `locations` —— 地点表（必填）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string `^loc_[a-zA-Z0-9_]+$` | ✓ | 稳定引用 ID |
| `name` | string(≥1) | ✓ | 地点名 |
| `type` | enum | | `interior`/`exterior`/`mixed`/`unknown` |
| `description` | string | | 地点描述 |
| `source_chapters` | integer[] | | 该地点出现的章节号 |

**设计原因**：地点独立成表（而非内联在场景里），是为了**复用与一致性**——“山海客栈”在第 1、2 章都出现，建一次、引多次，避免同地异名。`type` 的 `interior/exterior` 直接对应剧本场头的“内景 / 外景”，是导出标准场头的依据。

---

### 5.5 `timeline` —— 时间线（必填）

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string `^tl_[a-zA-Z0-9_]+$` | ✓ | 节点 ID |
| `order` | integer **≥ 0** | ✓ | 排序键，越小越早 |
| `label` | string | ✓ | 时间标签，如“第一日清晨” |
| `time_of_day` | enum | | `dawn`…`night`/`unspecified` |
| `description` | string | | 该节点剧情 |
| `related_scenes` | string[] | | 关联的 `scene id` |

**设计原因**：小说叙事可能倒叙 / 插叙，**章节顺序 ≠ 故事时间顺序**。`order` 用**整数排序键**而非依赖数组下标或具体日期——故事时间往往模糊（“多年以后”），整数序既能排序又不必虚构精确时间。`related_scenes` 把抽象时间节点挂回具体场次，支撑“按时间线重排剧本”这类二次创作。

---

### 5.6 `acts` / `episodes` —— 组织层（二选一或并存，可选）

两者结构相同：`{ id, title, summary?, scene_ids[] }`，ID 前缀分别为 `^act_…` 与 `^ep_…`。

**设计原因（关键扩展点）**：电影 / 舞台剧按**幕（act）**组织，电视剧 / 短剧按**集（episode）**组织。与其用一个含糊的“分组”字段，不如**显式双轨**：`metadata.format` 决定该填哪一个。组织层只存 `scene_ids` 的**引用列表**，不复制场景内容——同一批场景可以同时挂在不同的组织视角下，换载体时只需改组织层、不动 `scenes`。这是 **G5 可扩展**的核心设计。

---

### 5.7 `scenes` —— 分场（必填，核心）

每个场景对象：

| 字段 | 类型 | 必填 | 说明 |
|------|------|:--:|------|
| `id` | string `^scene_[a-zA-Z0-9_]+$` | ✓ | 场景 ID |
| `heading` | string(≥1) | ✓ | 场头，如“内景 客栈大堂 - 夜” |
| `elements` | Element[]（≥1） | ✓ | **场内有序的对白/动作/旁白/转场** |
| `slug` | string | | 简短机读标识，如 `c1-s1` |
| `location_id` | string | | 引用 `locations[].id` |
| `time` | enum | | 同 `time_of_day` 枚举 |
| `source_chapter` | integer ≥ 1 | | 来源章节号 |
| `source_refs` | SourceRef[]（≥1） | | 本场对应的原文段落范围 + 摘录 |
| `summary` | string | | 本场剧情摘要 |
| `characters` | string[] | | 出场人物 `id` 列表 |
| `mood` | string | | 情绪基调 |
| `pace` | enum | | `slow`/`medium`/`fast`/`unspecified` |
| `conflict` | string | | 本场核心冲突 |
| `adaptation` | object | | 本场改编记录（见 5.8） |

**`elements[]` —— 剧本元素（这是“可演内容”的载体）**

| 字段 | 必填 | 说明 |
|------|:--:|------|
| `type` | ✓ | `dialogue` / `action` / `narration` / `transition` |
| `text` | ✓\* | 台词 / 动作描写 / 旁白文字 / 转场名 |
| `character_id` | | `type=dialogue` 时的说话人，引用 `characters[].id` |
| `character_name` | | 冗余存名字，便于人眼直接阅读 |
| `parenthetical` | | 台词附注，如“（冷笑）” |
| `emotion` | | 情绪标记，如“愤怒” |

> \* Schema 用条件校验（`if/then`）确保四种类型都必须带 `text`。

**设计原因**：
- **为什么对白/动作/旁白/转场不各自建数组，而是统一进有序的 `elements`？** 因为一场戏的**精髓在于顺序**——“旁白→动作→A 说→B 说→转场”。若拆成 `dialogues[]`、`actions[]` 分列，就丢掉了交错的时序，无法还原成可读剧本。用一个**带 `type` 标签的有序数组**，既保留时序，又让每条都自描述。这也是导出 Fountain / PDF 的直接依据：遍历 `elements`，按 `type` 映射到标准剧本格式即可。
- **为什么同时存 `character_id` 和 `character_name`？** `id` 是给机器的稳定引用（改名不影响指向），`name` 是给人的可读冗余（不必反查人物表）。一份“拿来就能读”的初稿，两者都要。
- `mood`/`pace`/`conflict` 是给作者打磨用的**导演笔记**，机器非必需故选填。
- `source_refs` 见下：每场都能定位回原文段落（**G3**）。

> `SourceReference` 结构：`chapter_index`(≥1) · `chapter_title?` · `paragraph_start`(≥1) · `paragraph_end`(≥1) · `excerpt`(≥1)。**只存短摘录、不存整章**——足以定位与人工复核，又不让剧本文件背上整本原著。

---

### 5.8 改编记录：`adaptation`（场级） + `adaptation_notes`（全局）

**场级 `scenes[].adaptation`**：

```yaml
adaptation:
  strategy: compressed          # faithful/compressed/merged/rewritten/inferred
  ai_edits:
    - type: compression         # compression/merge/cut/rewrite/inference/reorder/other
      source_ref: P1-P2         # 可选，对应原文段落范围
      note: 将两段环境描写压缩为一句旁白。
```

**全局 `adaptation_notes[]`**：`{ scene_id?, type, note }`，`type` 取 `compression/merge/cut/inference/reorder/other`。

**设计原因（这是本工具区别于“黑箱生成器”的关键）**：小说转剧本**必然**伴随压缩、合并、删减、推断。如果 AI 静默地改，作者就无法信任、也无从打磨。于是把改编**显式记录成结构化数据**：
- `strategy` 给出整场的总体策略（一眼看出这场是“忠实”还是“重写”）；
- `ai_edits` 逐条列出改了什么、对应原文哪段；
- `adaptation_notes` 在全局层面汇总，便于通览审阅。

这让“AI 做了什么”从不可见变为**可见、可定位、可推翻**，正是 **G4** 的核心。

---

### 5.9 `open_questions` —— 待作者确认（可选）

`{ id: ^q_…, question, context?, scene_id? }`

**设计原因**：贯穿全工具的一条原则是**“拿不准就标注，绝不编造”**。当原文信息不足（如“真正的纵火者原文未点明”），AI 不臆造答案，而是写入一条 `open_questions` 交还作者裁决。这把模型的不确定性**外显**为待办项，而非藏进看似确定的正文，是初稿可信度的重要保障。

---

## 6. 校验：合法与非法

**最小合法剧本**（[`examples/valid-example.yaml`](../examples/valid-example.yaml)）只需满足六个必填顶层字段、ID 合法、`chapter_count ≥ 3`、每场 `heading` + 至少一个 `elements`：

```bash
node scripts/validate.mjs examples/valid-example.yaml   # PASS
```

**故意触发五类错误**（[`examples/invalid-example.yaml`](../examples/invalid-example.yaml)）：

```bash
node scripts/validate.mjs examples/invalid-example.yaml  # FAIL（退出码非 0）
```

| # | 错误 | 违反的设计约束 |
|---|------|----------------|
| 1 | `chapter_count: 2` | `source.chapter_count` 的 `minimum: 3`（赛题“≥3 章”） |
| 2 | `id: c1` | 人物 `id` 的 `^char_…` 前缀正则 |
| 3 | 场景缺 `heading` | `scenes[].heading` 必填 |
| 4 | `type: monologue` | `elements[].type` 封闭枚举 |
| 5 | `dialogue` 缺 `text` | 条件校验要求带 `text` |

校验逻辑见 [`lib/schema.ts`](../lib/schema.ts)（`ajv`，`allErrors: true` 一次列全所有错误）。

---

## 7. 设计权衡与常见疑问

**为什么几乎所有对象都 `additionalProperties: true`？**
为了**向前兼容**。剧本工具会持续演进（未来或加 `camera`、`vfx_note` 等字段）。允许额外字段意味着旧校验器不会因为新增字段而把新数据判为非法，老数据也能平滑升级。代价是拼写错字段名不会被拦截——这里选择了**演进友好 > 严格拒绝**，因为输出主要由后端受控生成，而非用户裸手填写。

**为什么大量字段选填、枚举里都留 `unknown`/`unspecified`？**
源数据是**自然语言小说**，信息天然残缺。强制必填会逼 AI 编造。把“信息不足”表达为合法状态（选填 / `unknown`），比假装确定更诚实，也与 §5.9 的原则一致。

**为什么内容信息进字段、而不直接让 AI 吐一段剧本文本？**
自由文本无法校验、无法回溯、无法被编辑器结构化操作。结构化是 G1–G4 的前提；“好看的剧本文本”是结构化数据的**渲染结果**（见前端台本视图与 Fountain 导出），而非存储形态。

---

## 8. 扩展指引

- **换载体（电影 / 剧集 / 短剧 / 广播剧）**：改 `metadata.format`，并在 `acts` ↔ `episodes` 之间切换组织层，`scenes` 不动（§5.6）。
- **导出 Fountain / PDF**：遍历 `scenes[].elements`，按 `type`（dialogue/action/narration/transition）映射到标准剧本格式——这正是 `elements` 设计为有序带类型数组的收益（§5.7）。
- **接入更多模型**：不影响 Schema；AI 只产 JSON，组装与序列化由后端统一负责（§3）。
- **新增字段**：得益于 `additionalProperties: true`，可先加字段、后补 Schema 约束，不破坏既有数据（§7）。

---

*本文档与 `schema/screenplay.schema.json`、`lib/types.ts` 保持同步；三者出现分歧时，以 `schema/screenplay.schema.json` 为权威。*
