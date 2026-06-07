import { describe, it, expect } from "vitest";
import { parseChapters, isHeadingLine, ChapterParseError, MIN_CHAPTERS } from "../lib/chapters";

describe("isHeadingLine", () => {
  it("识别中文章节标题", () => {
    expect(isHeadingLine("第一章 风雪夜")).toBe(true);
    expect(isHeadingLine("第一章：重逢")).toBe(true);
    expect(isHeadingLine("第 2 回 旧识")).toBe(true);
    expect(isHeadingLine("序章")).toBe(true);
    expect(isHeadingLine("楔子")).toBe(true);
  });

  it("识别英文章节标题", () => {
    expect(isHeadingLine("Chapter 1")).toBe(true);
    expect(isHeadingLine("Chapter One: The Storm")).toBe(true);
  });

  it("不把正文误判为标题", () => {
    expect(isHeadingLine("沈砚推门而入，肩头落满白雪。")).toBe(false);
    expect(isHeadingLine("")).toBe(false);
    expect(isHeadingLine("这一章讲述了很多很多很多很多很多很多很多很多的事情")).toBe(false);
  });
});

describe("parseChapters", () => {
  const novel = `第一章 起
内容一。

第二章 承
内容二。

第三章 转
内容三。`;

  it("拆分出三个章节并保留原文与摘要", () => {
    const chapters = parseChapters(novel);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].index).toBe(1);
    expect(chapters[0].title).toBe("第一章 起");
    expect(chapters[0].content).toContain("内容一");
    expect(chapters[0].summary).toBeTruthy();
  });

  it("识别中文数字与全角冒号的三章标题", () => {
    const text = `第一章：重逢
雨夜，林晚推开那家旧书店的门。

第二章：小结
她把旧诗集放回桌上。

第三章：余波
窗外的霓虹慢慢暗下去。`;

    const chapters = parseChapters(text);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe("第一章：重逢");
    expect(chapters[1].title).toBe("第二章：小结");
    expect(chapters[2].content).toContain("霓虹");
  });

  it("章节数不足时抛出明确错误", () => {
    const tooFew = `第一章 起
内容一。

第二章 承
内容二。`;
    expect(() => parseChapters(tooFew)).toThrow(ChapterParseError);
    expect(() => parseChapters(tooFew)).toThrow(new RegExp(`至少需要 ${MIN_CHAPTERS}`));
  });

  it("空输入抛错", () => {
    expect(() => parseChapters("")).toThrow(ChapterParseError);
    expect(() => parseChapters("   \n  ")).toThrow(ChapterParseError);
  });

  it("忽略首个标题之前的前言文本", () => {
    const withPreface = `这是一段没有标题的前言。

第一章 起
一。

第二章 承
二。

第三章 转
三。`;
    const chapters = parseChapters(withPreface);
    expect(chapters).toHaveLength(3);
    expect(chapters[0].title).toBe("第一章 起");
  });
});
