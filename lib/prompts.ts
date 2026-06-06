// ============================================================================
// AI 提示词模板（产品级）
// ----------------------------------------------------------------------------
// 通用约束（所有提示词共享）：
//  - 只输出合法 JSON（或在 YAML 修复场景下只输出合法 YAML），禁止任何额外说明文字。
//  - 禁止用 ```json 等 Markdown 代码块包裹输出。
//  - 必须保留原作关键信息（人物、地点、关键事件、台词原意）。
//  - 不得凭空添加重大剧情、人物或反转；可对原文做剧本化压缩、合并、改写。
//  - 拿不准之处宁可留空字段或写入 open_questions，也不要编造。
// ============================================================================

export interface PromptPair {
  system: string;
  user: string;
}

const BASE_RULES = `你是资深剧本改编师与故事分析师。你的输出将被程序直接解析，因此：
1. 只输出 JSON，不要输出任何解释、前言、结语。
2. 绝对禁止使用 Markdown 代码块（不要出现 \`\`\`）。
3. 保留原作关键信息，不要凭空新增重大剧情、人物或反转。
4. 允许进行剧本化的压缩、合并、删减与改写。
5. 所有文本字段使用简体中文。`;

function numberParagraphs(text: string): string {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.length
    ? paragraphs.map((p, i) => `P${i + 1}: ${p}`).join("\n")
    : "P1: （本章正文为空）";
}

// 1) 章节级分析
export function chapterAnalysisPrompt(chapter: {
  index: number;
  title: string;
  content: string;
}): PromptPair {
  return {
    system: `${BASE_RULES}

任务：分析单个小说章节。严格输出如下 JSON 结构（字段不可增减）：
{
  "summary": "本章 2-4 句话剧情摘要",
  "characters": [{"name":"人物名","aliases":["别名"],"role":"protagonist|antagonist|supporting|minor|narrator|unknown","note":"一句话定位"}],
  "locations": [{"name":"地点名","type":"interior|exterior|mixed|unknown"}],
  "events": ["按时间顺序的关键情节节点"],
  "conflicts": ["本章的冲突或转折，没有则空数组"],
  "key_dialogues": [{"speaker":"说话人","line":"原文关键台词（可压缩）"}]
}`,
    user: `章节序号：${chapter.index}
章节标题：${chapter.title}
章节正文：
${chapter.content}`,
  };
}

// 2) 人物汇总
export function characterExtractionPrompt(perChapterCharacters: string): PromptPair {
  return {
    system: `${BASE_RULES}

任务：将多章节的人物信息去重合并为统一人物表。同一人物的不同称呼应合并到 aliases。
严格输出 JSON：
{
  "characters": [{
    "name":"主名",
    "aliases":["别名"],
    "role":"protagonist|antagonist|supporting|minor|narrator|unknown",
    "description":"人物简介",
    "traits":["性格标签"],
    "arc":"人物弧光（如不明确填空字符串）"
  }]
}`,
    user: `各章节抽取到的人物（JSON 数组）：\n${perChapterCharacters}`,
  };
}

// 2b) AI 人物坐实 / 别名归一 / 证据链
export function characterResolutionPrompt(args: {
  chapters: { index: number; title: string; content: string; summary?: string }[];
  chapterAnalyses: unknown;
}): PromptPair {
  const numberedChapters = args.chapters
    .map((chapter) => `第 ${chapter.index} 章：${chapter.title}
${numberParagraphs(chapter.content)}`)
    .join("\n\n");

  return {
    system: `${BASE_RULES}

任务：做「人物坐实」与「称谓/别名/代词归一」。这是后续剧本生成引用人物 ID 的唯一依据。
你必须阅读原文段落，而不是只依赖章节摘要。

要求：
1. 同一人物的不同称呼必须合并到一个人物：如“她 / 女子 / 白衣女子 / 施主”应合并；“老方丈 / 方丈 / 师父”若语境一致也应合并。
2. 不要凭空给无名人物起真实姓名。原文没有姓名时，用最稳定、最具体的原文称谓作为 name，如“白衣女子”“灰衣僧人”。
3. aliases 写该人物在原文中的其他称呼、代词或身份称谓。
4. evidence 必须给出 1-3 条原文证据，标注 chapter_index、chapter_title、paragraph_start、paragraph_end、excerpt。
5. confidence 表示归一置信度：high / medium / low。拿不准的合并要拆开，或用 low 并在 description 说明。
6. 输出 characters 顺序按叙事重要性排序，主角在前。

严格输出 JSON：
{
  "characters": [{
    "name":"原文中最稳定的称谓或姓名",
    "aliases":["其他称呼/代词/身份"],
    "role":"protagonist|antagonist|supporting|minor|narrator|unknown",
    "description":"人物身份、目标、与主线关系",
    "traits":["性格/行动标签"],
    "arc":"人物弧光，不明确填空字符串",
    "confidence":"high|medium|low",
    "evidence":[{"chapter_index":1,"chapter_title":"第一章 标题","paragraph_start":2,"paragraph_end":2,"excerpt":"原文短摘录"}]
  }]
}`,
    user: `章节级分析结果（供参考，不可替代原文判断）：
${JSON.stringify(args.chapterAnalyses)}

原文（已按自然段编号）：
${numberedChapters}`,
  };
}

// 3) 世界观 / 背景设定提取
export function worldviewPrompt(chapterSummaries: string): PromptPair {
  return {
    system: `${BASE_RULES}

任务：基于各章摘要，提炼故事世界观与背景设定，并汇总地点表与时间线。
严格输出 JSON：
{
  "logline": "一句话故事梗概",
  "genre": ["题材标签"],
  "setting": "世界观/背景设定 3-6 句",
  "locations": [{"name":"地点","type":"interior|exterior|mixed|unknown","description":"简述"}],
  "timeline": [{"label":"时间节点标签","time_of_day":"dawn|morning|noon|afternoon|evening|night|unspecified","description":"该节点发生了什么"}]
}`,
    user: `各章摘要（按章节顺序）：\n${chapterSummaries}`,
  };
}

// 4) 剧本分场生成（按单章生成若干场）
export function sceneGenerationPrompt(args: {
  chapterIndex: number;
  chapterTitle: string;
  chapterContent: string;
  knownCharacters: string; // JSON：[{id,name,aliases}]
  knownLocations: string; // JSON：[{id,name}]
}): PromptPair {
  return {
    system: `${BASE_RULES}

任务：把一个章节改写为剧本「场」。一个章节可拆为 1-4 场。
- 尽量复用给定的 character_id 与 location_id；若出现新地点，location_id 留空并在 heading 中写出地点名。
- elements 必须按时间顺序排列，type 仅限 dialogue/action/narration/transition。
- dialogue 必须带 character_name；动作描写用 action；环境/心理旁白用 narration；转场用 transition。
- dialogue 的 character_id 必须引用“已知人物表”中的 id；character_name 使用该人物的 name，不要临时创造新名字。
- 若原文用代词或临时称谓说话，必须根据已知人物表 aliases 归一到正确 character_id。
- 本场 characters 必须列出所有出场人物 id，包括有动作但没有台词的人物。
- 为每场标注 mood（情绪）与 pace（slow|medium|fast）。
- 每场必须标注 source_refs：来自本章哪几段原文，paragraph_start/paragraph_end 使用从 1 开始的段落序号，excerpt 保留对应原文短摘录。
- 每场必须标注 adaptation：说明本场整体改编策略，以及 AI 对原文做了哪些压缩、合并、删减、重写、推断或重排。
- 若对原文做了压缩/合并/删减，写入 adaptation_notes。
- 不确定、需作者定夺的内容写入 open_questions。

严格输出 JSON：
{
  "scenes": [{
    "heading":"内景/外景 地点 - 时间，如：内景 客栈大堂 - 夜",
    "location_id":"loc_xxx 或空字符串",
    "time":"dawn|morning|noon|afternoon|evening|night|unspecified",
    "source_refs":[{"chapter_index":1,"chapter_title":"章节标题","paragraph_start":1,"paragraph_end":3,"excerpt":"对应原文短摘录"}],
    "summary":"本场摘要",
    "characters":["char_xxx"],
    "mood":"情绪基调",
    "pace":"slow|medium|fast",
    "conflict":"本场冲突/转折，可空",
    "adaptation":{
      "strategy":"faithful|compressed|merged|rewritten|inferred",
      "ai_edits":[{"type":"compression|merge|cut|rewrite|inference|reorder|other","source_ref":"P1-P3","note":"删改说明"}]
    },
    "elements":[
      {"type":"narration","text":"..."},
      {"type":"action","text":"..."},
      {"type":"dialogue","character_name":"张三","character_id":"char_xxx","text":"台词","parenthetical":"（冷笑）","emotion":"愤怒"},
      {"type":"transition","text":"切至"}
    ]
  }],
  "adaptation_notes":[{"type":"compression|merge|cut|inference|reorder|other","note":"说明"}],
  "open_questions":[{"question":"待确认问题","context":"相关上下文"}]
}`,
    user: `章节序号：${args.chapterIndex}
章节标题：${args.chapterTitle}
已知人物表：${args.knownCharacters}
已知地点表：${args.knownLocations}
章节正文（已按原文自然段编号，source_refs 必须引用这些编号）：
${numberParagraphs(args.chapterContent)}`,
  };
}

// 5) YAML 格式修复（模型直出 YAML 失败时的兜底）
export function yamlRepairPrompt(brokenYaml: string, parseError: string): PromptPair {
  return {
    system: `你是 YAML 修复器。下面给你一段不合法的 YAML 与解析报错。
请修复为合法 YAML，保持原有数据与结构，不要改变语义、不要新增内容。
只输出修复后的 YAML 本身，禁止任何解释，禁止使用 \`\`\` 包裹。`,
    user: `解析错误：${parseError}

待修复 YAML：
${brokenYaml}`,
  };
}

// 6) Schema 校验后自动修复
export function schemaRepairPrompt(args: {
  invalidJson: string;
  schema: string;
  errors: string;
}): PromptPair {
  return {
    system: `${BASE_RULES}

任务：给定一个不符合 JSON Schema 的剧本对象、对应的 Schema、以及校验错误列表，
请最小化修改使其通过校验：补全缺失必填字段（用合理占位）、修正枚举取值、删除非法字段。
不要丢失已有的有效数据，不要新增剧情。只输出修复后的完整剧本 JSON 对象。`,
    user: `JSON Schema：
${args.schema}

校验错误：
${args.errors}

待修复对象：
${args.invalidJson}`,
  };
}
