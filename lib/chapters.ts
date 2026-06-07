import type { Chapter } from "./types";

export const MIN_CHAPTERS = 3;

export class ChapterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterParseError";
  }
}

const CN_NUMERAL = "零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟";
const CHAPTER_UNIT = "章节回卷部篇集幕";
const MAX_HEADING_LENGTH = 40;

// Common Chinese/English chapter headings. A line must be short and standalone
// to reduce false positives from body text.
const HEADING_PATTERNS: RegExp[] = [
  new RegExp(
    `^\\s*第\\s*(?:\\d+|[${CN_NUMERAL}]+)\\s*[${CHAPTER_UNIT}](?:\\s*[:：、.．-]?\\s*.{0,30})?$`,
  ),
  /^\s*(序章|楔子|序言|引子|尾声|终章|番外篇?|后记|后序)\s*[:：]?.{0,20}$/,
  /^\s*(chapter|CHAPTER|Chapter)\s+([0-9]+|[ivxlcdmIVXLCDM]+|[A-Za-z]+)\b.*$/,
];

export function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return false;
  return HEADING_PATTERNS.some((re) => re.test(trimmed));
}

function makeSummary(content: string, maxLen = 70): string {
  const clean = content.replace(/\s+/g, "").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen)}...`;
}

export function parseChapters(rawText: string): Chapter[] {
  const text = (rawText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) {
    throw new ChapterParseError(`输入文本为空，请粘贴或上传至少 ${MIN_CHAPTERS} 个章节的小说内容。`);
  }

  const lines = text.split("\n");
  const chapters: Chapter[] = [];
  let current: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    if (isHeadingLine(line)) {
      if (current) {
        chapters.push(finalize(current, chapters.length + 1));
      }
      current = { title: line.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }

  if (current) {
    chapters.push(finalize(current, chapters.length + 1));
  }

  if (chapters.length < MIN_CHAPTERS) {
    throw new ChapterParseError(
      `仅识别到 ${chapters.length} 个章节，至少需要 ${MIN_CHAPTERS} 个。` +
        "请确认每章以「第N章」「序章」「Chapter N」等标题独占一行。",
    );
  }

  return chapters;
}

function finalize(raw: { title: string; body: string[] }, index: number): Chapter {
  const content = raw.body.join("\n").trim();
  return {
    index,
    title: raw.title,
    content,
    summary: makeSummary(content),
  };
}
