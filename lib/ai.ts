import OpenAI from "openai";
import {
  chapterAnalysisPrompt,
  characterExtractionPrompt,
  worldviewPrompt,
  sceneGenerationPrompt,
  schemaRepairPrompt,
  type PromptPair,
} from "./prompts";
import type { Chapter } from "./types";

export function isMockMode(): boolean {
  console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '已设置' : '未设置');
  if (process.env.USE_MOCK === "1") return true;
  console.log('OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? '已设置' : '未设置');
  return !process.env.OPENAI_API_KEY;
}

function getClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
}

function getModel(): string {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

/** 去除模型可能误加的 ``` 包裹。 */
function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json|yaml)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** 调用模型并解析为 JSON 对象。失败时抛错，由调用方决定是否回退。 */
async function callJson<T = any>(prompt: PromptPair): Promise<T> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: getModel(),
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  const content = res.choices[0]?.message?.content ?? "";
  return JSON.parse(stripFences(content)) as T;
}

export interface ChapterAnalysis {
  summary: string;
  characters: { name: string; aliases?: string[]; role?: string; note?: string }[];
  locations: { name: string; type?: string }[];
  events: string[];
  conflicts: string[];
  key_dialogues?: { speaker: string; line: string }[];
}

export function analyzeChapter(chapter: Chapter): Promise<ChapterAnalysis> {
  return callJson<ChapterAnalysis>(chapterAnalysisPrompt(chapter));
}

export function aggregateCharacters(perChapterCharacters: unknown): Promise<{ characters: any[] }> {
  return callJson(characterExtractionPrompt(JSON.stringify(perChapterCharacters)));
}

export function extractWorldview(summaries: string[]): Promise<{
  logline: string;
  genre: string[];
  setting: string;
  locations: { name: string; type?: string; description?: string }[];
  timeline: { label: string; time_of_day?: string; description?: string }[];
}> {
  return callJson(worldviewPrompt(summaries.map((s, i) => `第${i + 1}章：${s}`).join("\n")));
}

export function generateScenesForChapter(args: {
  chapter: Chapter;
  knownCharacters: { id: string; name: string; aliases?: string[] }[];
  knownLocations: { id: string; name: string }[];
}): Promise<{ scenes: any[]; adaptation_notes?: any[]; open_questions?: any[] }> {
  return callJson(
    sceneGenerationPrompt({
      chapterIndex: args.chapter.index,
      chapterTitle: args.chapter.title,
      chapterContent: args.chapter.content,
      knownCharacters: JSON.stringify(args.knownCharacters),
      knownLocations: JSON.stringify(args.knownLocations),
    }),
  );
}

export function repairAgainstSchema(args: {
  invalidJson: string;
  schema: string;
  errors: string;
}): Promise<any> {
  return callJson(schemaRepairPrompt(args));
}
