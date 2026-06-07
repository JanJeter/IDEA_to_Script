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
  type ChapterAnalysis,
  type SafetyReviewOutput,
  type SafetyTarget,
} from "./ai";
import { validateScreenplay, screenplaySchema, type ValidationResult } from "./schema";
import { toYaml } from "./yaml";
import type {
  AdaptationNote,
  Chapter,
  Character,
  Location,
  OpenQuestion,
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
const PACE_ENUM = ["slow", "medium", "fast", "unspecified"] as const;
const ADAPTATION_STRATEGY = ["faithful", "compressed", "merged", "rewritten", "inferred"] as const;
const ADAPTATION_CHANGE_TYPE = ["compression", "merge", "cut", "rewrite", "inference", "reorder", "other"] as const;
const NOTE_CHANGE_TYPE = ["compression", "merge", "cut", "inference", "reorder", "other"] as const;

interface ChapterSceneResult {
  scenes: Scene[];
  adaptationNotes: AdaptationNote[];
  openQuestions: OpenQuestion[];
}

function now(): number {
  return Date.now();
}

function elapsedSince(start: number): string {
  const ms = Date.now() - start;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function detailWithTiming(detail: string, start: number): string {
  return `${detail} (${elapsedSince(start)})`;
}

function getSceneConcurrency(): number {
  const raw = Number(process.env.AI_SCENE_CONCURRENCY ?? 3);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

async function parallelMapLimit<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function runSafetyReview(target: SafetyTarget, content: string): Promise<SafetyReviewOutput> {
  try {
    return await reviewContentSafety({ target, content });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "model call failed";
    return `BLOCK: content safety review failed: ${detail}`;
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

function nameMapFromCharacters(characters: Character[]): Map<string, string> {
  const nameToId = new Map<string, string>();
  characters.forEach((c) => {
    nameToId.set(c.name, c.id);
    c.aliases?.forEach((alias) => nameToId.set(alias, c.id));
  });
  return nameToId;
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

function mapScene(raw: any, chapter: Chapter, sceneNo: number, charNameToId: Map<string, string>): Scene {
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
    pace: coerce(raw?.pace, PACE_ENUM, "medium"),
    conflict: raw?.conflict ? String(raw.conflict) : "",
    adaptation,
    elements,
  };
}

function chapterExcerpt(chapter: Chapter, maxLen = 180): string {
  const clean = chapter.content.replace(/\s+/g, " ").trim() || chapter.summary || chapter.title;
  return clean.length <= maxLen ? clean : `${clean.slice(0, maxLen)}...`;
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

function mapAdaptationNote(raw: any, sceneId?: string): AdaptationNote {
  return {
    type: coerce(raw?.type, NOTE_CHANGE_TYPE, "other"),
    note: String(raw?.note ?? ""),
    scene_id: raw?.scene_id ? String(raw.scene_id) : sceneId,
  };
}

async function resolveCharactersWithFallback(chapters: Chapter[], analyses: ChapterAnalysis[]): Promise<{ characters: any[] }> {
  try {
    return await resolveCharacters({ chapters, chapterAnalyses: analyses });
  } catch {
    const allChars = analyses.flatMap((a) => a.characters ?? []);
    return aggregateCharacters(allChars);
  }
}

export async function* runPipeline(rawText: string, options: ConvertOptions = {}): AsyncGenerator<ConvertEvent> {
  const mock = isMockMode();
  const mode: "ai" | "mock" = mock ? "mock" : "ai";

  const sourceReviewStart = now();
  yield { type: "step", key: "source_review", label: "原文安全审核", status: "running" };
  const sourceReview = await runSafetyReview("source", rawText.slice(0, 2000));
  if (isBlocked(sourceReview)) {
    yield { type: "step", key: "source_review", label: "原文安全审核", status: "failed", detail: detailWithTiming(sourceReview, sourceReviewStart) };
    yield { type: "error", message: sourceReview };
    return;
  }
  yield { type: "step", key: "source_review", label: "原文安全审核", status: "done", detail: detailWithTiming(sourceReview, sourceReviewStart) };

  const parseStart = now();
  yield { type: "step", key: "parse", label: "章节解析", status: "running" };
  let chapters: Chapter[];
  try {
    chapters = parseChapters(rawText);
  } catch (e) {
    const msg = e instanceof ChapterParseError ? e.message : "章节解析失败";
    yield { type: "step", key: "parse", label: "章节解析", status: "failed", detail: detailWithTiming(msg, parseStart) };
    yield { type: "error", message: msg };
    return;
  }
  yield {
    type: "step",
    key: "parse",
    label: "章节解析",
    status: "done",
    detail: detailWithTiming(`识别到 ${chapters.length} 个章节`, parseStart),
  };

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

  let screenplay = baseline;
  try {
    const analyzeStart = now();
    yield { type: "step", key: "analyze", label: "章节级分析", status: "running" };
    const analyses = await Promise.all(chapters.map((chapter) => analyzeChapter(chapter)));
    chapters.forEach((chapter, i) => {
      chapter.summary = analyses[i]?.summary || chapter.summary;
    });
    yield {
      type: "step",
      key: "analyze",
      label: "章节级分析",
      status: "done",
      detail: detailWithTiming(`${analyses.length} 章已分析`, analyzeStart),
    };

    const aggregateStart = now();
    yield { type: "step", key: "aggregate", label: "人物/世界观汇总", status: "running" };
    const [charAgg, worldview] = await Promise.all([
      resolveCharactersWithFallback(chapters, analyses),
      extractWorldview(chapters.map((chapter) => chapter.summary ?? "")),
    ]);
    const mappedCharacters = mapResolvedCharacters(charAgg.characters ?? []);
    const aiCharacters = mappedCharacters.characters;
    const { locations } = mapLocations(worldview.locations ?? []);

    screenplay = {
      ...baseline,
      metadata: {
        ...baseline.metadata,
        logline: worldview.logline || baseline.metadata.logline,
        genre: Array.isArray(worldview.genre) ? worldview.genre : baseline.metadata.genre,
        generator: "aitransfer-script ai v0.1",
      },
      characters: aiCharacters.length ? aiCharacters : baseline.characters,
      locations: locations.length ? locations : baseline.locations,
    };
    const nameToId = aiCharacters.length ? mappedCharacters.nameToId : nameMapFromCharacters(screenplay.characters);
    yield {
      type: "step",
      key: "aggregate",
      label: "人物/世界观汇总",
      status: "done",
      detail: detailWithTiming(`${screenplay.characters.length} 人物 / ${screenplay.locations.length} 地点`, aggregateStart),
    };

    const scenesStart = now();
    const concurrency = getSceneConcurrency();
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "running", detail: `并发 ${concurrency}` };
    const knownChars = screenplay.characters.map((c) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
    }));
    const knownLocs = screenplay.locations.map((l) => ({ id: l.id, name: l.name }));

    const perChapter = await parallelMapLimit<Chapter, ChapterSceneResult>(chapters, concurrency, async (chapter) => {
      try {
        const out = await generateScenesForChapter({ chapter, knownCharacters: knownChars, knownLocations: knownLocs });
        const scenes = (out.scenes ?? []).map((s, i) => mapScene(s, chapter, i + 1, nameToId));
        return {
          scenes: scenes.length ? scenes : baseline.scenes.filter((s) => s.source_chapter === chapter.index),
          adaptationNotes: (out.adaptation_notes ?? []).map((n: any) => mapAdaptationNote(n)),
          openQuestions: (out.open_questions ?? []).map((q: any, idx: number) => ({
            id: `q_c${chapter.index}_${idx + 1}`,
            question: String(q?.question ?? ""),
            context: q?.context ? String(q.context) : undefined,
          })),
        };
      } catch {
        return {
          scenes: baseline.scenes.filter((s) => s.source_chapter === chapter.index),
          adaptationNotes: [
            {
              type: "inference" as const,
              note: `第 ${chapter.index} 章 AI 分场失败，已回退规则生成。`,
              scene_id: undefined,
            },
          ],
          openQuestions: [],
        };
      }
    });

    const scenes = perChapter.flatMap((result) => result.scenes);
    const adaptationNotes = perChapter.flatMap((result) => result.adaptationNotes);
    const openQuestions = perChapter.flatMap((result) => result.openQuestions);
    screenplay = { ...screenplay, scenes, adaptation_notes: adaptationNotes, open_questions: openQuestions };
    yield {
      type: "step",
      key: "scenes",
      label: "分场剧本生成",
      status: "done",
      detail: detailWithTiming(`${scenes.length} 场，并发 ${concurrency}`, scenesStart),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 转换失败";
    yield { type: "step", key: "scenes", label: "分场剧本生成", status: "failed", detail: `${msg}（已回退 mock）` };
    screenplay = baseline;
  }

  yield* finalize(screenplay, mode, chapters);
}

async function* finalize(screenplay: Screenplay, mode: "ai" | "mock", chapters: Chapter[]): AsyncGenerator<ConvertEvent> {
  const validateStart = now();
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
      // Keep the original validation result when repair fails.
    }
  }

  yield {
    type: "step",
    key: "validate",
    label: "Schema 校验",
    status: validation.valid ? "done" : "failed",
    detail: detailWithTiming(validation.valid ? "通过" : `${validation.errors.length} 处错误`, validateStart),
  };

  const yaml = toYaml(final);
  const screenplayReviewStart = now();
  yield { type: "step", key: "screenplay_review", label: "剧本安全审核", status: "running" };
  const screenplayReview = await runSafetyReview("screenplay", yaml);
  if (isBlocked(screenplayReview)) {
    yield {
      type: "step",
      key: "screenplay_review",
      label: "剧本安全审核",
      status: "failed",
      detail: detailWithTiming(screenplayReview, screenplayReviewStart),
    };
    yield { type: "error", message: screenplayReview };
    return;
  }
  yield {
    type: "step",
    key: "screenplay_review",
    label: "剧本安全审核",
    status: "done",
    detail: detailWithTiming(screenplayReview, screenplayReviewStart),
  };

  yield {
    type: "result",
    mode,
    screenplay: final,
    yaml,
    validation,
    chapters: chapters.map((c) => ({ index: c.index, title: c.title, summary: c.summary })),
  };
}
