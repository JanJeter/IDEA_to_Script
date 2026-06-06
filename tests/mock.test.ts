import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseChapters } from "../lib/chapters";
import { generateMockScreenplay } from "../lib/mock";
import { validateScreenplay } from "../lib/schema";

const sample = readFileSync(path.join(process.cwd(), "examples/sample-novel.txt"), "utf-8");

describe("generateMockScreenplay", () => {
  const chapters = parseChapters(sample);
  const screenplay = generateMockScreenplay(chapters, { novelTitle: "山海客栈" });

  it("从示例小说生成的剧本通过 Schema 校验", () => {
    const result = validateScreenplay(screenplay);
    if (!result.valid) console.error(result.errors);
    expect(result.valid).toBe(true);
  });

  it("场景数与章节数一致，且每场都能回溯来源章节", () => {
    expect(screenplay.scenes).toHaveLength(chapters.length);
    for (const scene of screenplay.scenes) {
      expect(scene.source_chapter).toBeGreaterThanOrEqual(1);
    }
  });

  it("每场戏都标注原文章节段落与 AI 删改说明", () => {
    for (const scene of screenplay.scenes) {
      expect(scene.source_refs?.length).toBeGreaterThan(0);
      expect(scene.source_refs?.[0].chapter_index).toBe(scene.source_chapter);
      expect(scene.source_refs?.[0].paragraph_start).toBeGreaterThanOrEqual(1);
      expect(scene.source_refs?.[0].paragraph_end).toBeGreaterThanOrEqual(scene.source_refs?.[0].paragraph_start ?? 1);
      expect(scene.source_refs?.[0].excerpt).toBeTruthy();
      expect(scene.adaptation?.ai_edits.length).toBeGreaterThan(0);
      expect(scene.adaptation?.ai_edits[0].note).toBeTruthy();
    }
  });

  it("从对白中抽取到人物", () => {
    const names = screenplay.characters.map((c) => c.name);
    expect(names).toContain("沈砚");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("抽取到地点（含客栈）", () => {
    const locNames = screenplay.locations.map((l) => l.name).join(",");
    expect(locNames).toMatch(/客栈|城|街|楼/);
  });

  it("source.chapter_count >= 3", () => {
    expect(screenplay.source.chapter_count).toBeGreaterThanOrEqual(3);
  });
});
