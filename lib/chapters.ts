import type { Chapter } from "./types";

export const MIN_CHAPTERS = 3;

export class ChapterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterParseError";
  }
}

// 中文/英文常见章节标题模式。命中且整行较短时才视为标题，避免误伤正文。
const HEADING_PATTERNS: RegExp[] = [
  // 第一章 / 第1章 / 第 十二 回 / 第三卷 …（后可跟标题）。
  // 注意：不能在中文字符后用 \b（ASCII 词边界，在中文间不成立）。
  /^\s*第\s*[0-9零一二三四五六七八九十百千两壹贰叁肆伍陆柒捌玖拾佰]+\s*[章回节卷部篇集](\s.*)?$/,
  // 序章 / 楔子 / 序言 / 尾声 / 终章 / 番外 / 后记
  /^\s*(序章|楔子|序言|引子|尾声|终章|番外篇?|后记|后序)\s*[:：]?.{0,20}$/,
  // Chapter 1 / Chapter One / CHAPTER 12: Title
  /^\s*(chapter|CHAPTER|Chapter)\s+([0-9]+|[ivxlcdmIVXLCDM]+|[A-Za-z]+)\b.*$/,
];

const MAX_HEADING_LENGTH = 40;

export function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) return false;
  return HEADING_PATTERNS.some((re) => re.test(trimmed));
}

function makeSummary(content: string, maxLen = 70): string {
  const clean = content.replace(/\s+/g, "").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "…";
}

/**
 * 将小说原文拆分为章节数组。确定性逻辑，不调用 AI，便于单元测试。
 * - 自动识别章节标题
 * - 保留每章原文 content
 * - 生成截取式 summary（AI 阶段会被更高质量摘要覆盖）
 * 章节数不足 MIN_CHAPTERS 时抛出 ChapterParseError。
 */
export function parseChapters(rawText: string): Chapter[] {
  const text = (rawText ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.trim()) {
    throw new ChapterParseError("输入文本为空，请粘贴或上传至少 3 个章节的小说内容。");
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
    // 首个标题之前的散落文本（前言）忽略，避免把没有标题的内容当作章节。
  }
  if (current) {
    chapters.push(finalize(current, chapters.length + 1));
  }

  if (chapters.length < MIN_CHAPTERS) {
    throw new ChapterParseError(
      `仅识别到 ${chapters.length} 个章节，至少需要 ${MIN_CHAPTERS} 个。` +
        `请确认每章以「第N章」「序章」「Chapter N」等标题独占一行。`,
    );
  }

  return chapters;
}

function finalize(
  raw: { title: string; body: string[] },
  index: number,
): Chapter {
  const content = raw.body.join("\n").trim();
  return {
    index,
    title: raw.title,
    content,
    summary: makeSummary(content),
  };
}
