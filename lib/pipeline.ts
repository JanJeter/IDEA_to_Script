import { parseChapters, ChapterParseError } from "./chapters";
import { generateMockScreenplay } from "./mock";
import {
  isMockMode,
  analyzeChapter,
  aggregateCharacters,
  extractWorldview,
  generateScenesForChapter,
  repairAgainstSchema,
} from "./ai";
import { validateScreenplay, screenplaySchema, type ValidationResult } from "./schema";
import { toYaml } from "./yaml";
import type {
  Chapter,
  Character,
  Location,
  Scene,
  SceneElement,
  Screenplay,
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

function coerce<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

// 把 AI 返回的人物数组规整为带稳定 id 的 Character[]，并建立 名称/别名 -> id 映射。
function mapCharacters(raw: any[]): { characters: Character[]; nameToId: Map<string, string> } {
  const nameToId = new Map<string, string>();
  const characters: Character[] = (raw ?? []).map((c, i) => {
    const id = `char_${i + 1}`;
    const name = String(c?.name ?? `人物${i + 1}`);
    nameToId.set(name, id);
    (c?.aliases ?? []).forEach((a: string) => nameToId.set(String(a), id));
    return {
      id,
      name,
      aliases: Array.isArray(c?.aliases) ? c.aliases.map(String) : [],
      role: coerce(c?.role, ["protagonist", "antagonist", "supporting", "minor", "narrator", "unknown"] as const, "supporting"),
      description: c?.description ? String(c.description) : "",
      traits: Array.isArray(c?.traits) ? c.traits.map(String) : [],
      arc: c?.arc ? String(c.arc) : "",
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
  chapterIndex: number,
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

  return {
    id: `scene_c${chapterIndex}_s${sceneNo}`,
    heading: String(raw?.heading ?? `第${chapterIndex}章 第${sceneNo}场`),
    slug: `c${chapterIndex}-s${sceneNo}`,
    location_id: raw?.location_id ? String(raw.location_id) : undefined,
    time: coerce(raw?.time, TIME_ENUM, "unspecified"),
    source_chapter: chapterIndex,
    summary: raw?.summary ? String(raw.summary) : "",
    characters: [...new Set(elements.filter((e) => e.character_id).map((e) => e.character_id as string))],
    mood: raw?.mood ? String(raw.mood) : "平稳",
    pace: coerce(raw?.pace, ["slow", "medium", "fast", "unspecified"] as const, "medium"),
    conflict: raw?.conflict ? String(raw.conflict) : "",
    elements,
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
    const allChars = analyses.flatMap((a) => a.characters ?? []);
    const charAgg = await aggregateCharacters(allChars);
    const { characters, nameToId } = mapCharacters(charAgg.characters ?? []);

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
    const knownChars = screenplay.characters.map((c) => ({ id: c.id, name: c.name, aliases: c.aliases }));
    const knownLocs = screenplay.locations.map((l) => ({ id: l.id, name: l.name }));
    const scenes: Scene[] = [];
    const adaptationNotes = [...(screenplay.adaptation_notes ?? [])];
    const openQuestions = [...(screenplay.open_questions ?? [])];

    for (const chapter of chapters) {
      try {
        const out = await generateScenesForChapter({ chapter, knownCharacters: knownChars, knownLocations: knownLocs });
        const mapped = (out.scenes ?? []).map((s, i) => mapScene(s, chapter.index, i + 1, nameToId));
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

  yield {
    type: "result",
    mode,
    screenplay: final,
    yaml: toYaml(final),
    validation,
    chapters: chapters.map((c) => ({ index: c.index, title: c.title, summary: c.summary })),
  };
}
