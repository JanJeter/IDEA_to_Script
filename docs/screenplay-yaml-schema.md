# 剧本 YAML Schema 设计文档

本文件定义「AI 小说转剧本工具」输出的剧本 YAML 结构，对应机读校验文件 [`schema/screenplay.schema.json`](../schema/screenplay.schema.json)（JSON Schema draft-07）。

---

## 1. Schema 设计目标

1. **结构化**：把自由小说文本转成机器可读、可程序化处理的剧本结构。
2. **可校验**：任意一份输出都能被 ajv 严格校验，错误可定位到具体字段。
3. **可编辑**：字段语义清晰、层级浅、命名直观，作者能直接手改 YAML。
4. **可回溯**：每个场景保留来源章节，方便对照原文打磨。
5. **可扩展**：同一套核心结构可覆盖电影、电视剧、短剧、舞台剧、广播剧。
6. **AI 友好**：字段都是扁平、枚举受限的简单类型，降低模型生成与修复成本。

---

## 2. 顶层字段总览

| 字段 | 类型 | 必填 | 含义 |
|------|------|------|------|
| `metadata` | object | ✅ | 剧本元信息（标题、题材、载体、语言等） |
| `source` | object | ✅ | 原小说来源信息（标题、作者、章节索引） |
| `characters` | array | ✅ | 人物表 |
| `locations` | array | ✅ | 场景地点表 |
| `timeline` | array | ✅ | 时间线节点 |
| `acts` | array | ❌ | 分幕结构（电影/舞台剧） |
| `episodes` | array | ❌ | 分集结构（电视剧/短剧） |
| `scenes` | array | ✅ | **核心结构**：分场，对白/动作/旁白/转场内联其中 |
| `adaptation_notes` | array | ❌ | 改编说明（压缩/合并/删减/推断） |
| `open_questions` | array | ❌ | 未解决问题 / 待作者确认项 |

> `acts` 与 `episodes` 均为可选，二者可并存或都不填——载体不同选择不同的组织维度，但底层都引用同一批 `scenes`。

---

## 3. 各字段详细说明

### 3.1 `metadata`（必填）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `title` | string | ✅ | 剧本标题 |
| `logline` | string | ❌ | 一句话故事梗概 |
| `genre` | string[] | ❌ | 题材标签 |
| `format` | enum | ✅ | `film`/`tv`/`short`/`stage`/`radio`/`drama` |
| `language` | string | ✅ | 语言代码，如 `zh-CN` |
| `created_at` | string | ❌ | ISO 8601 生成时间 |
| `generator` | string | ❌ | 生成工具与版本 |

### 3.2 `source`（必填）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `novel_title` | string | ✅ | 原小说标题 |
| `author` | string | ❌ | 原作者 |
| `chapter_count` | integer ≥ 3 | ✅ | 识别到的章节数，**必须 ≥ 3** |
| `total_length` | integer ≥ 0 | ❌ | 原文字符总数 |
| `source_chapters` | array | ❌ | 章节索引（`index` / `title` / `summary`） |

### 3.3 `characters`（必填，数组项）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `id` | string `^char_…` | ✅ | 稳定引用 ID |
| `name` | string | ✅ | 主名 |
| `aliases` | string[] | ❌ | 别名（用于对白说话人归一） |
| `role` | enum | ❌ | `protagonist`/`antagonist`/`supporting`/`minor`/`narrator`/`unknown` |
| `description` | string | ❌ | 人物简介 |
| `traits` | string[] | ❌ | 性格标签 |
| `arc` | string | ❌ | 人物弧光 |

### 3.4 `locations`（必填，数组项）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `id` | string `^loc_…` | ✅ | 稳定引用 ID |
| `name` | string | ✅ | 地点名 |
| `type` | enum | ❌ | `interior`/`exterior`/`mixed`/`unknown` |
| `description` | string | ❌ | 地点描述 |
| `source_chapters` | integer[] | ❌ | 出现章节 |

### 3.5 `timeline`（必填，数组项）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `id` | string `^tl_…` | ✅ | 引用 ID |
| `order` | integer ≥ 0 | ✅ | 排序键，越小越早 |
| `label` | string | ✅ | 时间节点标签 |
| `time_of_day` | enum | ❌ | `dawn`/`morning`/`noon`/`afternoon`/`evening`/`night`/`unspecified` |
| `description` | string | ❌ | 该节点发生了什么 |
| `related_scenes` | string[] | ❌ | 关联场景 id |

### 3.6 `scenes`（必填，核心结构，数组项）

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `id` | string `^scene_…` | ✅ | 场景引用 ID |
| `heading` | string | ✅ | 场景标题行，如「内景 客栈大堂 - 夜」 |
| `slug` | string | ❌ | 简短机读标识 |
| `location_id` | string | ❌ | 引用 `locations[].id` |
| `time` | enum | ❌ | 同 `time_of_day` 取值 |
| `source_chapter` | integer ≥ 1 | ❌ | **来源章节索引（保证可回溯）** |
| `summary` | string | ❌ | 本场摘要 |
| `characters` | string[] | ❌ | 出场人物 id |
| `mood` | string | ❌ | 情绪基调 |
| `pace` | enum | ❌ | `slow`/`medium`/`fast`/`unspecified`（节奏标记） |
| `conflict` | string | ❌ | 本场冲突/转折 |
| `elements` | array | ✅ | 按时间顺序排列的剧本元素 |

`elements[]` 单项：

| 子字段 | 类型 | 必填 | 含义 |
|--------|------|------|------|
| `type` | enum | ✅ | `dialogue`/`action`/`narration`/`transition` |
| `text` | string | ✅* | 内容（四种类型都必填 text） |
| `character_id` | string | ❌ | `dialogue` 的说话人 id |
| `character_name` | string | ❌ | 冗余存名，便于人眼阅读 |
| `parenthetical` | string | ❌ | 台词附注，如「（冷笑）」 |
| `emotion` | string | ❌ | 情绪标记 |

### 3.7 `adaptation_notes` / `open_questions`（可选）

- `adaptation_notes[]`：`{ scene_id?, type, note }`，`type ∈ compression/merge/cut/inference/reorder/other`。
- `open_questions[]`：`{ id(^q_…), question, context?, scene_id? }`。

---

## 4. YAML 示例（最小可用）

```yaml
metadata:
  title: 山海客栈（剧本初稿）
  logline: 一名落魄剑客在边城客栈卷入一桩旧案。
  genre: [武侠, 悬疑]
  format: drama
  language: zh-CN
source:
  novel_title: 山海客栈
  author: 佚名
  chapter_count: 3
  total_length: 1280
  source_chapters:
    - { index: 1, title: 第一章 风雪夜, summary: 剑客投宿客栈。 }
characters:
  - { id: char_1, name: 沈砚, role: protagonist, traits: [沉默, 重情] }
  - { id: char_2, name: 老掌柜, role: supporting }
locations:
  - { id: loc_1, name: 山海客栈, type: interior }
timeline:
  - { id: tl_1, order: 0, label: 第一夜, time_of_day: night, related_scenes: [scene_c1_s1] }
scenes:
  - id: scene_c1_s1
    heading: 内景 山海客栈大堂 - 夜
    location_id: loc_1
    time: night
    source_chapter: 1
    summary: 沈砚冒雪投宿，与老掌柜照面。
    characters: [char_1, char_2]
    mood: 压抑
    pace: medium
    elements:
      - { type: narration, text: 风雪封门，灯火摇曳。 }
      - { type: action, text: 沈砚推门而入，肩头落满白雪。 }
      - { type: dialogue, character_id: char_2, character_name: 老掌柜, text: 客官，打尖还是住店？, emotion: 平和 }
      - { type: dialogue, character_id: char_1, character_name: 沈砚, text: 住店。, parenthetical: （低声） }
adaptation_notes:
  - { scene_id: scene_c1_s1, type: compression, note: 原章环境描写较长，已压缩为两句旁白。 }
open_questions:
  - { id: q_1, question: 老掌柜是否知情？需作者确认其立场。 }
```

---

## 5. 设计原因（关键决策）

### 5.1 为什么用 `scenes` 作为核心结构

剧本的最小可拍摄/可排演单元是「场」（scene），不是「幕」或「集」。

- **幕/集是组织维度，场是内容维度**：电影分幕、电视剧分集，但二者都由场构成。把场作为核心、用 `acts`/`episodes` 仅存 `scene_ids` 引用，可让同一批内容在不同载体间自由重组，无需复制数据。
- **AI 生成与人工编辑的天然颗粒度**：模型按章产出若干场最稳定；作者也以场为单位增删改。
- **避免深层嵌套**：若把对白嵌在幕→集→场→段多层结构里，校验与编辑都困难。扁平的 `scenes` 数组 + 引用关系更易维护。

### 5.2 为什么保留 source chapter 信息

- **可回溯**：改编初稿必然有损（压缩、合并），作者需要随时对照原文。`scene.source_chapter` 与 `source.source_chapters` 让每一场都能定位回原章。
- **增量重生成**：未来支持「只重做第 3 章」时，靠 `source_chapter` 精确定位要替换的场景。
- **版权与审校**：保留来源是改编作品的合规基本要求。

### 5.3 为什么区分 `dialogue` / `action` / `narration`

这是剧本与小说的根本差异，也是后续导出（Fountain、PDF、配音脚本）的基础：

- `dialogue`（对白）：角色说的话，需要演员演绎，带说话人与情绪。
- `action`（动作描写）：镜头里发生的、可被拍摄的行为与环境。
- `narration`（旁白）：画外音/内心独白，**广播剧尤其依赖**。
- `transition`（转场）：剪辑提示，如「切至」「淡出」。

小说原文常把三者混在一段叙述里。显式区分后，下游可以：按说话人统计戏份、单独导出配音台词、为旁白单独配音、剔除转场做纯对白本等。

### 5.4 为什么加入 `adaptation_notes`

改编是「有损转换」，工具必须**对作者透明**：哪里压缩了、哪里合并了、哪里是 AI 推断的。`adaptation_notes` 把这些操作显式记录，作者可据此决定是否回滚或补全，避免 AI「偷偷改剧情」却无从追查。这是产品可信度的关键。

### 5.5 为什么有 `open_questions`

AI 改编必然遇到原文未交代清楚、或需要创作决策的地方。与其让模型**编造**，不如把不确定点上抛为待确认项，交给作者定夺——这与提示词中「拿不准宁可留空，不要编造」的约束一致。

---

## 6. 如何扩展到不同载体

核心 `scenes` 不变，仅切换组织层与个别字段语义：

| 载体 | `metadata.format` | 组织层 | 侧重 |
|------|------|--------|------|
| 电影 | `film` | `acts`（三幕） | `action` 镜头感、`pace` |
| 电视剧 | `tv` | `episodes`（每集多场） | 集尾钩子、`conflict` |
| 短剧 | `short` | `episodes`（强节奏，每集 1-3 场） | `pace: fast`、强 `conflict` |
| 舞台剧 | `stage` | `acts` + 幕场 | `location` 固定、`narration` 少 |
| 广播剧 | `radio` | `episodes` | `dialogue` + `narration` 为主，`action` 转为音效旁白 |

扩展时**不破坏**已有 Schema：新增字段一律走 `additionalProperties: true` 允许的可选扩展位（如给 `scene` 加 `sound_effects`、给 `metadata` 加 `runtime_minutes`），老数据仍然有效。

---

## 7. Schema 校验规则要点

- 顶层必须含：`metadata`、`source`、`characters`、`locations`、`timeline`、`scenes`。
- `source.chapter_count` 必须 **≥ 3**（对应"至少 3 章"产品需求）。
- `id` 字段有前缀正则约束：`char_` / `loc_` / `tl_` / `act_` / `ep_` / `scene_` / `q_`。
- `scenes` 至少 1 项；每个 scene 的 `elements` 至少 1 项。
- 所有 `enum` 字段取值受限（如 `element.type` 只能是四种之一）。
- 顶层与各对象 `additionalProperties: true`：**允许扩展**，但已定义字段的类型/枚举仍被严格校验。

---

## 8. 常见错误示例

### 错误 1：章节数不足
```yaml
source:
  novel_title: 测试
  chapter_count: 2   # ❌ minimum 3
```
报错：`source/chapter_count must be >= 3`。原因：产品要求至少 3 章。

### 错误 2：枚举取值非法
```yaml
scenes:
  - id: scene_c1_s1
    heading: 内景 - 夜
    elements:
      - { type: monologue, text: ... }   # ❌ type 必须是 dialogue/action/narration/transition
```
报错：`.../type must be equal to one of the allowed values`。

### 错误 3：id 不符合前缀规则
```yaml
characters:
  - { id: c1, name: 张三 }   # ❌ 必须匹配 ^char_[a-zA-Z0-9_]+$
```
报错：`.../id must match pattern "^char_[a-zA-Z0-9_]+$"`。

### 错误 4：缺少必填字段
```yaml
scenes:
  - id: scene_c1_s1
    # ❌ 缺少 heading 与 elements
    summary: 某场
```
报错：`must have required property 'heading'` 与 `'elements'`。

### 错误 5：element 缺少 text
```yaml
elements:
  - { type: dialogue, character_name: 张三 }   # ❌ dialogue 必须有 text
```
报错：`must have required property 'text'`。

> 完整的「通过」与「失败」样例见 [`examples/`](../examples/) 目录。
