import OpenAI from "openai";
import {
  chapterAnalysisPrompt,
  characterExtractionPrompt,
  characterResolutionPrompt,
  worldviewPrompt,
  sceneGenerationPrompt,
  schemaRepairPrompt,
  contentSafetyReviewPrompt,
  type PromptPair,
} from "./prompts";
import type { Chapter } from "./types";

export function isMockMode(): boolean {
  if (process.env.USE_MOCK === "1") return true;
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

async function callText(prompt: PromptPair, temperature = 0): Promise<string> {
  const client = getClient();
  const res = await client.chat.completions.create({
    model: getModel(),
    temperature,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  return stripFences(res.choices[0]?.message?.content ?? "");
}

export type SafetyTarget = "source" | "screenplay";
export type SafetyReviewOutput = "PASS" | `BLOCK: ${string}`;

export function normalizeSafetyReviewOutput(text: string): SafetyReviewOutput {
  const firstLine = stripFences(text).split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  if (/^PASS\b/i.test(firstLine)) return "PASS";

  const block = firstLine.match(/^BLOCK\s*[:：]\s*(.+)$/i);
  if (block?.[1]?.trim()) return `BLOCK: ${block[1].trim()}`;

  return "BLOCK: 内容安全审查返回格式异常";
}

function mockReviewContentSafety(content: string): SafetyReviewOutput {
  const normalized = content.replace(/\s+/g, "");
  const rules: { pattern: RegExp; reason: string }[] = [
    { pattern: /色情|涉黄|裸聊|卖淫|嫖娼|性交易|强奸|猥亵|乱伦|性侵/, reason: "包含涉黄或性违法风险内容" },
    { pattern: /虐杀|酷刑|分尸|血腥|自杀教程|杀人方法|爆炸物制作|制毒|贩毒/, reason: "包含暴力或违法违规风险内容" },
    { pattern: /颠覆国家|恐怖主义|极端主义|分裂国家|煽动暴乱/, reason: "包含政治敏感或极端违法风险内容" },
  ];
  const hit = rules.find((rule) => rule.pattern.test(normalized));
  return hit ? `BLOCK: ${hit.reason}` : "PASS";
}

export async function reviewContentSafety(args: {
  target: SafetyTarget;
  content: string;
}): Promise<SafetyReviewOutput> {
  if (isMockMode()) {
    return mockReviewContentSafety(args.content);
  }

  const output = await callText(contentSafetyReviewPrompt(args), 0);
  return normalizeSafetyReviewOutput(output);
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

export function resolveCharacters(args: {
  chapters: Chapter[];
  chapterAnalyses: unknown;
}): Promise<{ characters: any[] }> {
  return callJson(characterResolutionPrompt({
    chapters: args.chapters,
    chapterAnalyses: args.chapterAnalyses,
  }));
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
