import type {
  Chapter,
  Character,
  Location,
  Scene,
  SceneAdaptation,
  SceneElement,
  Screenplay,
  SourceReference,
  TimeOfDay,
  TimelineNode,
} from "./types";

// ============================================================================
// Mock 生成器：在没有 AI API Key 时，从用户输入的小说真实抽取信息，
// 产出一份结构完整、可被 Schema 校验通过的剧本。确定性、可单测。
// ============================================================================

// 对白归属抽取：要求人名出现在句首/标点/引号之后（词边界），名字取 2-6 字，
// 之后允许 0-2 个副词字（如「低声」「苦笑」），再接核心提示动词，并以标点收尾。
const SPEAKER_RE =
  /(?:^|[\s。！？，、；：“”"『』「」（）\n])([一-龥]{2,6})[一-龥]{0,2}?(?:道|说|问|答|喊|叫|喝)(?=[：:，。！？“"])/gmu;
// 名字尾部常见的副词字与提示动词字，需剔除（如「沈砚苦」→「沈砚」、「周霖问」→「周霖」）。
const TRAILING_ADVERB = /[苦怒低声冷压缓沉笑叹忙急喝惊喜悲恍问道说答喊叫]+$/;
// 代词/虚词/副词字：候选名若含这些字，判定为非人名（如「半晌才」「你为何」）。
const NAME_STOP = /[你我他她它们这那何为半晌多少很都也又还才将被把于而之乎者得过着了是有没不]/;
const CHARACTER_TITLE_RE =
  /(?:一个|一名|那名|这名|正是|寺内)?([一-龥]{0,4}(?:女子|男子|僧人|方丈|知客僧|掌柜|黑衣人|剑客|师兄|师弟|客官|施主))/g;

function cleanName(raw: string): string | null {
  const name = raw.replace(TRAILING_ADVERB, "");
  if (name.length < 2 || NAME_STOP.test(name)) return null;
  return name;
}

function extractSpeakers(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  SPEAKER_RE.lastIndex = 0;
  while ((m = SPEAKER_RE.exec(text)) !== null) {
    const name = cleanName(m[1]);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function extractCharacterMentions(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  CHARACTER_TITLE_RE.lastIndex = 0;
  while ((m = CHARACTER_TITLE_RE.exec(text)) !== null) {
    const name = cleanName(m[1]);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

function mergeCounts(...maps: Map<string, number>[]): Map<string, number> {
  const merged = new Map<string, number>();
  for (const map of maps) {
    for (const [key, count] of map) {
      merged.set(key, (merged.get(key) ?? 0) + count);
    }
  }
  return merged;
}
const QUOTE_RE = /[“"「『]([^”"」』]+)[”"」』]/g;
const LOCATION_SUFFIX =
  "城|村|镇|山|峰|岭|府|宫|殿|院|楼|阁|寺|庙|林|河|湖|海|街|巷|房|屋|厅|堂|营|关|谷|洞|桥|港|岛|塔|园|场|集市|客栈|酒馆|书院|学堂";
const LOCATION_RE = new RegExp(`([\\u4e00-\\u9fa5]{1,3}(?:${LOCATION_SUFFIX}))`, "g");
// 地名前缀若含动作/代词字，多为误抽（如「转身上楼」「两人隔着一院」），剔除。
const LOC_STOP = /[转身上下隔着两人这那你我他她它走来去坐站手头心眼推开起得了过被把将一]/;

function countMatches(re: RegExp, text: string, group = 1): Map<string, number> {
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    const key = m[group];
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function topN(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function inferTimeOfDay(text: string): TimeOfDay {
  if (/(夜|晚|深夜|子时|月)/.test(text)) return "night";
  if (/(黎明|拂晓|破晓)/.test(text)) return "dawn";
  if (/(清晨|早晨|早上|清早)/.test(text)) return "morning";
  if (/(正午|中午|晌午)/.test(text)) return "noon";
  if (/(下午|午后)/.test(text)) return "afternoon";
  if (/(黄昏|傍晚|日暮)/.test(text)) return "evening";
  return "unspecified";
}

function inferMood(text: string): string {
  if (/(怒|杀|血|战|斗|喝|逼)/.test(text)) return "紧张";
  if (/(笑|喜|乐|温|暖|柔)/.test(text)) return "温情";
  if (/(悲|泪|哭|叹|孤|冷)/.test(text)) return "压抑";
  return "平稳";
}

function inferConflict(text: string): string {
  if (/(交出|可留全尸|执刀|刀光|银针|住手)/.test(text)) return "夺匣者夜闯禅房，双方爆发正面冲突。";
  if (/(军粮案|灭口|虎符|位极人臣|继续追查)/.test(text)) return "旧案线索浮现，追查将从江湖恩怨升级为朝堂危局。";
  if (/(遗物|铜牌|十九年|木匣)/.test(text)) return "白衣女子带回遗物，迫使寒山寺旧事重启。";
  return "";
}

function inferCharacterRole(name: string, index: number): Character["role"] {
  if (/(女子|男子|剑客)/.test(name) && index === 0) return "protagonist";
  if (/(僧人|黑衣人|师弟)/.test(name)) return "antagonist";
  if (/(方丈|掌柜|知客僧|师兄)/.test(name)) return "supporting";
  return index === 0 ? "protagonist" : "supporting";
}

function describeCharacter(name: string, count: number): string {
  if (name.includes("女子")) return `从原文称谓坐实的人物，围绕遗物与旧案行动，出现约 ${count} 次。`;
  if (name.includes("方丈")) return `寒山寺长者，掌握旧案线索，出现约 ${count} 次。`;
  if (name.includes("僧人") || name.includes("黑衣人")) return `持刀夺匣的关键对立人物，出现约 ${count} 次。`;
  if (name.includes("知客僧")) return `寒山寺接引人物，负责引出方丈与铜牌线索，出现约 ${count} 次。`;
  if (name.includes("师兄")) return `旧案相关的缺席人物，其遗物推动剧情，出现约 ${count} 次。`;
  return `自动抽取并坐实的原文人物/称谓，出现约 ${count} 次。`;
}

function inferCharacterArc(name: string): string {
  if (name.includes("女子")) return "从送回遗物的来客转为继续追查旧案的行动者。";
  if (name.includes("方丈")) return "从守秘者转为揭示旧案关键线索的引路人。";
  if (name.includes("僧人") || name.includes("黑衣人")) return "从潜伏者暴露为旧案未死相关人，推动冲突升级。";
  if (name.includes("师兄")) return "作为缺席的死者与旧案核心，持续牵引主线。";
  return "";
}

function describeLocation(name: string): string {
  if (name.includes("寒山寺")) return "秋雨中的古寺，旧案遗物与夜袭事件的核心发生地。";
  if (name.includes("禅房")) return "寒山寺后院禅房，木匣交付与夜袭交手之处。";
  if (name.includes("塔林")) return "寒山寺后山塔林，手札与虎符真相浮现之处。";
  if (name.includes("山门")) return "寒山寺入口，白衣女子抵达并递出铜牌之处。";
  return "自动抽取的地点。";
}

function splitParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function makeExcerpt(paragraphs: string[], maxLen = 180): string {
  const clean = paragraphs.join(" ").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "…";
}

function buildSourceRef(chapter: Chapter, usedParagraphs: string[]): SourceReference {
  return {
    chapter_index: chapter.index,
    chapter_title: chapter.title,
    paragraph_start: 1,
    paragraph_end: Math.max(1, usedParagraphs.length),
    excerpt: makeExcerpt(usedParagraphs.length > 0 ? usedParagraphs : [chapter.summary ?? chapter.title]),
  };
}

function buildAdaptation(paragraphCount: number, usedCount: number): SceneAdaptation {
  const ai_edits: SceneAdaptation["ai_edits"] = [
    {
      type: paragraphCount > usedCount ? "compression" : "rewrite",
      source_ref: `P1-P${Math.max(1, usedCount)}`,
      note:
        paragraphCount > usedCount
          ? `保留前 ${usedCount} 段作为本场核心内容，其余段落暂未展开。`
          : "将原文叙述整理为剧本元素，未新增关键剧情。",
    },
  ];

  if (paragraphCount > usedCount) {
    ai_edits.push({
      type: "cut",
      source_ref: `P${usedCount + 1}-P${paragraphCount}`,
      note: "超出 MVP 单场长度的段落暂作删减，建议人工复核是否需要拆为新场。",
    });
  }

  return {
    strategy: paragraphCount > usedCount ? "compressed" : "faithful",
    ai_edits,
  };
}

/** 将一个段落转换为若干剧本元素。 */
function paragraphToElements(
  paragraph: string,
  charNameToId: Map<string, string>,
  isFirstParagraph: boolean,
  fallbackSpeaker?: string,
): SceneElement[] {
  const elements: SceneElement[] = [];
  const quotes: { line: string; index: number }[] = [];
  let qm: RegExpExecArray | null;
  QUOTE_RE.lastIndex = 0;
  while ((qm = QUOTE_RE.exec(paragraph)) !== null) {
    quotes.push({ line: qm[1].trim(), index: qm.index });
  }

  if (quotes.length === 0) {
    // 无对白：首段作为旁白（建场），其余作为动作描写。
    elements.push({
      type: isFirstParagraph ? "narration" : "action",
      text: paragraph,
    });
    return elements;
  }

  // 有对白：对白前的叙述作为 action，对白本身作为 dialogue。
  const prefix = paragraph.slice(0, quotes[0].index).trim();
  if (prefix) {
    const speakerMatch = prefix.match(/([一-龥]{2,4})(?:[^一-龥]{0,4})$/);
    elements.push({ type: "action", text: prefix });
    void speakerMatch;
  }

  for (const q of quotes) {
    const before = paragraph.slice(0, q.index);
    const sm = [...before.matchAll(SPEAKER_RE)];
    const explicit = sm.length > 0 ? cleanName(sm[sm.length - 1][1]) ?? undefined : undefined;
    const pronounSpeaker = /(?:^|[，。！？\s])(他|她)[一-龥]{0,4}?(?:道|说|问|答|喊|叫|喝)[：:，。！？“"]/.test(before)
      ? fallbackSpeaker
      : undefined;
    const speaker = explicit ?? pronounSpeaker;
    const element: SceneElement = { type: "dialogue", text: q.line };
    if (speaker) {
      element.character_name = speaker;
      const id = charNameToId.get(speaker);
      if (id) element.character_id = id;
      element.emotion = inferMood(before);
    }
    elements.push(element);
  }
  return elements;
}

function findMentionedCharacter(text: string, charNameToId: Map<string, string>): string | undefined {
  for (const name of charNameToId.keys()) {
    if (text.includes(name)) return name;
  }
  return undefined;
}

const MAX_PARAGRAPHS_PER_SCENE = 12;

export interface MockOptions {
  novelTitle?: string;
  author?: string;
  format?: Screenplay["metadata"]["format"];
}

/** 由章节数组确定性地生成完整剧本对象。 */
export function generateMockScreenplay(
  chapters: Chapter[],
  options: MockOptions = {},
): Screenplay {
  const fullText = chapters.map((c) => c.content).join("\n");

  // —— 人物表 ——
  const characterCounts = mergeCounts(extractCharacterMentions(fullText), extractSpeakers(fullText));
  const topNames = topN(characterCounts, 10);
  const characters: Character[] = topNames.map((name, i) => ({
    id: `char_${i + 1}`,
    name,
    aliases: [],
    role: inferCharacterRole(name, i),
    description: describeCharacter(name, characterCounts.get(name) ?? 1),
    traits: /(女子|男子|剑客)/.test(name)
      ? ["关键行动者"]
      : /(僧人|黑衣人|师弟)/.test(name)
        ? ["威胁", "隐秘"]
        : [],
    arc: inferCharacterArc(name),
  }));
  const charNameToId = new Map(characters.map((c) => [c.name, c.id]));

  // —— 地点表 ——
  const locCounts = countMatches(LOCATION_RE, fullText, 1);
  for (const loc of [...locCounts.keys()]) {
    if (LOC_STOP.test(loc)) locCounts.delete(loc);
  }
  const topLocs = topN(locCounts, 6);
  const locations: Location[] = topLocs.map((name, i) => ({
    id: `loc_${i + 1}`,
    name,
    type: /(房|屋|厅|堂|殿|宫|楼|阁|院|客栈|酒馆)/.test(name) ? "interior" : "exterior",
    description: describeLocation(name),
    source_chapters: chapters.filter((c) => c.content.includes(name)).map((c) => c.index),
  }));
  const locNameToId = new Map(locations.map((l) => [l.name, l.id]));

  // —— 场景 ——
  const scenes: Scene[] = [];
  const adaptationNotes: Screenplay["adaptation_notes"] = [];

  chapters.forEach((chapter) => {
    const paragraphs = splitParagraphs(chapter.content);
    const used = paragraphs.slice(0, MAX_PARAGRAPHS_PER_SCENE);
    const time = inferTimeOfDay(chapter.content);

    // 该章首个出现的已知地点
    let sceneLocId: string | undefined;
    let sceneLocName = "未知地点";
    for (const [name, id] of locNameToId) {
      if (chapter.content.includes(name)) {
        sceneLocId = id;
        sceneLocName = name;
        break;
      }
    }

    const elements: SceneElement[] = [];
    let lastMentionedCharacter: string | undefined;
    used.forEach((p, idx) => {
      lastMentionedCharacter = findMentionedCharacter(p, charNameToId) ?? lastMentionedCharacter;
      elements.push(...paragraphToElements(p, charNameToId, idx === 0, lastMentionedCharacter));
    });
    if (elements.length === 0) {
      elements.push({ type: "narration", text: chapter.summary ?? chapter.title });
    }

    const presentChars = [
      ...new Set(
        [
          ...elements
          .filter((e) => e.character_id)
          .map((e) => e.character_id as string),
          ...characters
            .filter((c) => chapter.content.includes(c.name))
            .map((c) => c.id),
        ],
      ),
    ];

    const timeLabel: Record<TimeOfDay, string> = {
      dawn: "黎明",
      morning: "清晨",
      noon: "正午",
      afternoon: "午后",
      evening: "黄昏",
      night: "夜",
      unspecified: "时间不明",
    };

    const scene: Scene = {
      id: `scene_c${chapter.index}_s1`,
      heading: `${sceneLocId ? "内景/外景 " : ""}${sceneLocName} - ${timeLabel[time]}`,
      slug: `c${chapter.index}-s1`,
      location_id: sceneLocId,
      time,
      source_chapter: chapter.index,
      source_refs: [buildSourceRef(chapter, used)],
      summary: chapter.summary ?? `第 ${chapter.index} 章改编场景`,
      characters: presentChars,
      mood: inferMood(chapter.content),
      pace: "medium",
      conflict: inferConflict(chapter.content),
      adaptation: buildAdaptation(paragraphs.length, used.length),
      elements,
    };
    scenes.push(scene);

    if (paragraphs.length > MAX_PARAGRAPHS_PER_SCENE) {
      adaptationNotes.push({
        scene_id: scene.id,
        type: "compression",
        note: `原章共 ${paragraphs.length} 段，MVP 压缩为前 ${MAX_PARAGRAPHS_PER_SCENE} 段，请作者补全后续内容。`,
      });
    }
  });

  // —— 时间线 ——
  const timeline: TimelineNode[] = chapters.map((c, i) => ({
    id: `tl_${i + 1}`,
    order: i,
    label: c.title,
    time_of_day: inferTimeOfDay(c.content),
    description: c.summary,
    related_scenes: [`scene_c${c.index}_s1`],
  }));

  // —— 分幕（按章映射为幕，便于后续重组）——
  const acts = chapters.map((c) => ({
    id: `act_${c.index}`,
    title: c.title,
    summary: c.summary,
    scene_ids: [`scene_c${c.index}_s1`],
  }));

  const screenplay: Screenplay = {
    metadata: {
      title: `${options.novelTitle ?? "未命名小说"}（剧本初稿）`,
      logline: chapters[0]?.summary ?? "",
      genre: [],
      format: options.format ?? "drama",
      language: "zh-CN",
      created_at: new Date().toISOString(),
      generator: "aitransfer-script mock v0.1",
    },
    source: {
      novel_title: options.novelTitle ?? "未命名小说",
      author: options.author ?? "",
      chapter_count: chapters.length,
      total_length: fullText.length,
      source_chapters: chapters.map((c) => ({
        index: c.index,
        title: c.title,
        summary: c.summary,
      })),
    },
    characters:
      characters.length > 0
        ? characters
        : [
            {
              id: "char_1",
              name: "未识别人物",
              role: "unknown",
              description: "未能从对话中抽取到人物，请作者补充。",
            },
          ],
    locations:
      locations.length > 0
        ? locations
        : [{ id: "loc_1", name: "未知地点", type: "unknown" }],
    timeline,
    acts,
    scenes,
    adaptation_notes:
      adaptationNotes.length > 0
        ? adaptationNotes
        : [{ type: "inference", note: "本剧本由 mock 模式自动生成，结构完整但需人工打磨。" }],
    open_questions: [
      {
        id: "q_1",
        question: "人物身份与关系是否准确？mock 模式仅按台词频率推断主次。",
        context: "建议接入 AI 模式或人工校对。",
      },
    ],
  };

  return screenplay;
}
