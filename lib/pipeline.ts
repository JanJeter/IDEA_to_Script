import { parseChapters, ChapterParseError } from "./chapters";
import { generateMockScreenplay } from "./mock";
import {
  isMockMode,
  analyzeChapter,
  aggregateCharacters,
  resolveCharacters,
  extractWorldview,
  generateScenesForChapter,
  repairAgainstSchema,
  reviewContentSafety,
  type SafetyReviewOutput,
  type SafetyTarget,
} from "./ai";
import { validateScreenplay, screenplaySchema, type ValidationResult } from "./schema";
import { toYaml } from "./yaml";
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
} from "./types";

export interface ConvertOptions {
  novelTitle?: string;
  author?: string;
  format?: Screenplay["metadata"]["format"];
}

export type ConvertEvent =
  | { type: "step"; key: string; label: string; status: "running" | "done" | "failed"; detail?: string }
  | {
      type: "result";
      mode: "ai" | "mock";
      screenplay: Screenplay;
      yaml: string;
      validation: ValidationResult;
      chapters: { index: number; title: string; summary?: string }[];
    }
  | { type: "error"; message: string };

const TIME_ENUM: TimeOfDay[] = ["dawn", "morning", "noon", "afternoon", "evening", "night", "unspecified"];
const ADAPTATION_STRATEGY = ["faithful", "compressed", "merged", "rewritten", "inferred"] as const;
const ADAPTATION_CHANGE_TYPE = ["compression", "merge", "cut", "rewrite", "inference", "reorder", "other"] as const;

async function runSafetyReview(target: SafetyTarget, content: string): Promise<SafetyReviewOutput> {
  try {
    return await reviewContentSafety({ target, content });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "模型调用失败";
    return `BLOCK: 内容安全审查失败：${detail}`;
  }
}

function isBlocked(review: SafetyReviewOutput): boolean {
  return review.startsWith("BLOCK:");
}

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// 把 AI 返回的人物数组规整为带稳定 id 的 Character[]，并建立 名称/别名 -> id 映射。
function mapCharacterEvidence(raw: any): SourceReference[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const evidence = raw
    .map((ref: any): SourceReference | null => {
      const excerpt = ref?.excerpt ? String(ref.excerpt).trim() : "";
      if (!excerpt) return null;
      const start = Number(ref?.paragraph_start);
      const end = Number(ref?.paragraph_end);
      const chapterIndex = Number(ref?.chapter_index);
      return {
        chapter_index: Number.isInteger(chapterIndex) && chapterIndex > 0 ? chapterIndex : 1,
        chapter_title: ref?.chapter_title ? String(ref.chapter_title) : undefined,
        paragraph_start: Number.isInteger(start) && start > 0 ? start : 1,
        paragraph_end: Number.isInteger(end) && end > 0 ? end : Math.max(1, Number.isInteger(start) ? start : 1),
        excerpt,
      };
    })
    .filter(Boolean) as SourceReference[];
  return evidence.length ? evidence : undefined;
}

export function mapResolvedCharacters(raw: any[]): { characters: Character[]; nameToId: Map<string, string> } {
  const nameToId = new Map<string, string>();
  const characters: Character[] = (raw ?? []).map((c, i) => {
    const id = `char_${i + 1}`;
    const name = String(c?.name ?? `人物${i + 1}`);
    nameToId.set(name, id);
    (c?.aliases ?? []).forEach((a: string) => nameToId.set(String(a), id));
    if (c?.canonical_name) nameToId.set(String(c.canonical_name), id);
    return {
      id,
      name,
      aliases: Array.isArray(c?.aliases) ? c.aliases.map(String) : [],
      role: coerce(c?.role, ["protagonist", "antagonist", "supporting", "minor", "narrator", "unknown"] as const, "supporting"),
      description: c?.description ? String(c.description) : "",
      traits: Array.isArray(c?.traits) ? c.traits.map(String) : [],
      arc: c?.arc ? String(c.arc) : "",
      evidence: mapCharacterEvidence(c?.evidence),
      confidence: coerce(c?.confidence, ["high", "medium", "low"] as const, "medium"),
    };
  });
  return { characters, nameToId };
}

function mapLocations(raw: any[]): { locations: Location[]; nameToId: Map<string, string> } {
  const nameToId = new Map<string, string>();
  const locations: Location[] = (raw ?? []).map((l, i) => {
    const id = `loc_${i + 1}`;
    const name = String(l?.name ?? `地点${i + 1}`);
    nameToId.set(name, id);
    return {
      id,
      name,
      type: coerce(l?.type, ["interior", "exterior", "mixed", "unknown"] as const, "unknown"),
      description: l?.description ? String(l.description) : "",
      source_chapters: [],
    };
  });
  return { locations, nameToId };
}

function mapScene(
  raw: any,
  chapter: Chapter,
  sceneNo: number,
  charNameToId: Map<string, string>,
): Scene {
  const elements: SceneElement[] = (raw?.elements ?? [])
    .map((e: any): SceneElement | null => {
      const type = coerce(e?.type, ["dialogue", "action", "narration", "transition"] as const, "action");
      const text = e?.text ? String(e.text) : "";
      if (!text) return null;
      const el: SceneElement = { type, text };
      if (type === "dialogue") {
        if (e?.character_name) el.character_name = String(e.character_name);
        const id = e?.character_id || (el.character_name && charNameToId.get(el.character_name));
        if (id) el.character_id = String(id);
        if (e?.parenthetical) el.parenthetical = String(e.parenthetical);
        if (e?.emotion) el.emotion = String(e.emotion);
      }
      return el;
    })
    .filter(Boolean) as SceneElement[];

  if (elements.length === 0) {
    elements.push({ type: "narration", text: String(raw?.summary ?? "（本场待补充）") });
  }

  const sourceRefs = mapSourceRefs(raw?.source_refs, chapter);
  const adaptation = mapAdaptation(raw?.adaptation, sourceRefs);
  const chapterIndex = chapter.index;

  return {
    id: `scene_c${chapterIndex}_s${sceneNo}`,
    heading: String(raw?.heading ?? `第${chapterIndex}章 第${sceneNo}场`),
    slug: `c${chapterIndex}-s${sceneNo}`,
    location_id: raw?.location_id ? String(raw.location_id) : undefined,
    time: coerce(raw?.time, TIME_ENUM, "unspecified"),
    source_chapter: chapterIndex,
    source_refs: sourceRefs,
    summary: raw?.summary ? String(raw.summary) : "",
    characters: [
      ...new Set([
        ...(Array.isArray(raw?.characters) ? raw.characters.map(String) : []),
        ...elements.filter((e) => e.character_id).map((e) => e.character_id as string),
      ]),
    ],
    mood: raw?.mood ? String(raw.mood) : "平稳",
    pace: coerce(raw?.pace, ["slow", "medium", "fast", "unspecified"] as const, "medium"),
    conflict: raw?.conflict ? String(raw.conflict) : "",
    adaptation,
    elements,
  };
}

function chapterExcerpt(chapter: Chapter, maxLen = 180): string {
  const clean = chapter.content.replace(/\s+/g, " ").trim() || chapter.summary || chapter.title;
  return clean.length <= maxLen ? clean : clean.slice(0, maxLen) + "…";
}

function mapSourceRefs(raw: any, chapter: Chapter): SourceReference[] {
  const refs = Array.isArray(raw) ? raw : [];
  const mapped = refs
    .map((ref: any): SourceReference | null => {
      const excerpt = ref?.excerpt ? String(ref.excerpt).trim() : "";
      if (!excerpt) return null;
      const start = Number(ref?.paragraph_start);
      const end = Number(ref?.paragraph_end);
      return {
        chapter_index: Number.isInteger(Number(ref?.chapter_index)) ? Number(ref.chapter_index) : chapter.index,
        chapter_title: ref?.chapter_title ? String(ref.chapter_title) : chapter.title,
        paragraph_start: Number.isInteger(start) && start > 0 ? start : 1,
        paragraph_end: Number.isInteger(end) && end > 0 ? end : Math.max(1, Number.isInteger(start) ? start : 1),
        excerpt,
      };
    })
    .filter(Boolean) as SourceReference[];

  return mapped.length
    ? mapped
    : [
        {
          chapter_index: chapter.index,
          chapter_title: chapter.title,
          paragraph_start: 1,
          paragraph_end: 1,
          excerpt: chapterExcerpt(chapter),
        },
      ];
}

function mapAdaptation(raw: any, refs: SourceReference[]): SceneAdaptation {
  const rawEdits = Array.isArray(raw?.ai_edits) ? raw.ai_edits : [];
  const ai_edits = rawEdits
    .map((edit: any) => {
      const note = edit?.note ? String(edit.note).trim() : "";
      if (!note) return null;
      return {
        type: coerce(edit?.type, ADAPTATION_CHANGE_TYPE, "other"),
        note,
        source_ref: edit?.source_ref ? String(edit.source_ref) : undefined,
      };
    })
    .filter(Boolean) as SceneAdaptation["ai_edits"];

  return {
    strategy: coerce(raw?.strategy, ADAPTATION_STRATEGY, "rewritten"),
    ai_edits: ai_edits.length
      ? ai_edits
      : [
          {
            type: "rewrite",
            source_ref: `P${refs[0].paragraph_start}-P${refs[0].paragraph_end}`,
            note: "将原文章节内容改写为剧本场景，具体删改未由模型细分。",
          },
        ],
  };
}

/**
 * 主转换管线。返回异步事件流，便于前端逐步展示进度。
 * 五步：①章节解析 ②章节级分析 ③人物/世界观汇总 ④分场生成 ⑤Schema 校验/修复。
 */
export async function* runPipeline(
  rawText: string,
  options: ConvertOptions = {},
): AsyncGenerator<ConvertEvent> {
  const mock = isMockMode();
  const mode: "ai" | "mock" = mock ? "mock" : "ai";

  yield { type: "step", key: "source_review", label: "原文安全审核", status: "running" };
  const sourceReview = await runSafetyReview("source", rawText.slice(0, 2000));
  if (isBlocked(sourceReview)) {
    yield { type: "step", key: "source_review", label: "原文安全审核", status: "failed", detail: sourceReview };
    yield { type: "error", message: sourceReview };
    return;
  }
  yield { type: "step", key: "source_review", label: "原文安全审核", status: "done", detail: sourceReview };

  // —— 第 1 步：章节解析（确定性）——
  yield { type: "step", key: "parse", label: "章节解析", status: "running" };
  let chapters: Chapter[];
  try {
    chapters = parseChapters(rawText);
  } catch (e) {
    const msg = e instanceof ChapterParseError ? e.message : "章节解析失败";
    yield { type: "step", key: "parse", label: "章节解析", status: "failed", detail: msg };
    yield { type: "error", message: msg };
    return;
  }
  yield {
    type: "step",
    key: "parse",
    label: "章节解析",
    status: "done",
    detail: `识别到 ${chapters.length} 个章节`,
  };

  // 始终先算一份 mock 基线，保证任何 AI 步骤失败都能完整兜底。
  const baseline = generateMockScreenplay(chapters, options);

  if (mock) {
    yield { type: "step", key: "analyze", label: "章节级分析", status: "running" };
    yield { type: "step", key: "analyze", label: "章节级分析", status: "done", detail: "mock 模式：基于规则抽取" };
    yield { type: "step", key: "aggregate", label: "人物/世界观汇总", status: "running" };
    yield { type: "step", key: "aggregate", label: "人物/世界观汇总", status: "done", detail: `${baseline.characters.length} 人物 / ${baseline.locations.length} 地点` };
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "running" };
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "done", detail: `${baseline.scenes.length} 场` };

    yield* finalize(baseline, "mock", chapters);
    return;
  }

  // —— AI 模式 ——
  let screenplay = baseline;
  try {
    // 第 2 步：章节级分析
    yield { type: "step", key: "analyze", label: "章节级分析", status: "running" };
    const analyses = await Promise.all(chapters.map((c) => analyzeChapter(c)));
    chapters.forEach((c, i) => (c.summary = analyses[i]?.summary || c.summary));
    yield { type: "step", key: "analyze", label: "章节级分析", status: "done", detail: `${analyses.length} 章已分析` };

    // 第 3 步：人物 + 世界观汇总
    yield { type: "step", key: "aggregate", label: "人物/世界观汇总", status: "running" };
    let charAgg: { characters: any[] };
    try {
      charAgg = await resolveCharacters({ chapters, chapterAnalyses: analyses });
    } catch {
      const allChars = analyses.flatMap((a) => a.characters ?? []);
      charAgg = await aggregateCharacters(allChars);
    }
    const { characters, nameToId } = mapResolvedCharacters(charAgg.characters ?? []);

    const worldview = await extractWorldview(chapters.map((c) => c.summary ?? ""));
    const { locations } = mapLocations(worldview.locations ?? []);

    screenplay = {
      ...baseline,
      metadata: {
        ...baseline.metadata,
        logline: worldview.logline || baseline.metadata.logline,
        genre: Array.isArray(worldview.genre) ? worldview.genre : baseline.metadata.genre,
        generator: "aitransfer-script ai v0.1",
      },
      characters: characters.length ? characters : baseline.characters,
      locations: locations.length ? locations : baseline.locations,
    };
    yield {
      type: "step",
      key: "aggregate",
      label: "人物/世界观汇总",
      status: "done",
      detail: `${screenplay.characters.length} 人物 / ${screenplay.locations.length} 地点`,
    };

    // 第 4 步：分场生成（逐章；单章失败回退该章 mock 场景）
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "running" };
    const knownChars = screenplay.characters.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      evidence: c.evidence,
      confidence: c.confidence,
      description: c.description,
    }));
    const knownLocs = screenplay.locations.map((l) => ({ id: l.id, name: l.name }));
    const scenes: Scene[] = [];
    const adaptationNotes: any[] = [];
    const openQuestions: any[] = [];

    for (const chapter of chapters) {
      try {
        const out = await generateScenesForChapter({ chapter, knownCharacters: knownChars, knownLocations: knownLocs });
        const mapped = (out.scenes ?? []).map((s, i) => mapScene(s, chapter, i + 1, nameToId));
        scenes.push(...(mapped.length ? mapped : baseline.scenes.filter((s) => s.source_chapter === chapter.index)));
        (out.adaptation_notes ?? []).forEach((n: any) =>
          adaptationNotes.push({ type: coerce(n?.type, ["compression", "merge", "cut", "inference", "reorder", "other"] as const, "other"), note: String(n?.note ?? ""), scene_id: n?.scene_id }),
        );
        (out.open_questions ?? []).forEach((q: any, idx: number) =>
          openQuestions.push({ id: `q_c${chapter.index}_${idx + 1}`, question: String(q?.question ?? ""), context: q?.context ? String(q.context) : undefined }),
        );
      } catch {
        scenes.push(...baseline.scenes.filter((s) => s.source_chapter === chapter.index));
        adaptationNotes.push({ type: "inference", note: `第 ${chapter.index} 章 AI 分场失败，已回退规则生成。` });
      }
    }
    screenplay = { ...screenplay, scenes, adaptation_notes: adaptationNotes, open_questions: openQuestions };
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "done", detail: `${scenes.length} 场` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 转换失败";
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "failed", detail: `${msg}（已回退 mock）` };
    screenplay = baseline;
  }

  yield* finalize(screenplay, mode, chapters);
}

// —— 第 5 步：Schema 校验 + 修复 + 序列化 ——
async function* finalize(
  screenplay: Screenplay,
  mode: "ai" | "mock",
  chapters: Chapter[],
): AsyncGenerator<ConvertEvent> {
  yield { type: "step", key: "validate", label: "Schema 校验", status: "running" };
  let final = screenplay;
  let validation = validateScreenplay(final);

  if (!validation.valid && mode === "ai") {
    try {
      const repaired = await repairAgainstSchema({
        invalidJson: JSON.stringify(final),
        schema: JSON.stringify(screenplaySchema),
        errors: JSON.stringify(validation.errors),
      });
      const reval = validateScreenplay(repaired);
      if (reval.valid) {
        final = repaired as Screenplay;
        validation = reval;
      }
    } catch {
      /* 修复失败则保留原校验结果 */
    }
  }

  yield {
    type: "step",
    key: "validate",
    label: "Schema 校验",
    status: validation.valid ? "done" : "failed",
    detail: validation.valid ? "通过" : `${validation.errors.length} 处错误`,
  };

  const yaml = toYaml(final);
  yield { type: "step", key: "screenplay_review", label: "剧本安全审核", status: "running" };
  const screenplayReview = await runSafetyReview("screenplay", yaml);
  if (isBlocked(screenplayReview)) {
    yield {
      type: "step",
      key: "screenplay_review",
      label: "剧本安全审核",
      status: "failed",
      detail: screenplayReview,
    };
    yield { type: "error", message: screenplayReview };
    return;
  }
  yield { type: "step", key: "screenplay_review", label: "剧本安全审核", status: "done", detail: screenplayReview };

  yield {
    type: "result",
    mode,
    screenplay: final,
    yaml,
    validation,
    chapters: chapters.map((c) => ({ index: c.index, title: c.title, summary: c.summary })),
  };
}
