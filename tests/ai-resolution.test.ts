import { describe, expect, it } from "vitest";
import { mapResolvedCharacters } from "../lib/pipeline";

describe("mapResolvedCharacters", () => {
  it("保留 AI 人物坐实结果中的别名、证据与置信度", () => {
    const { characters, nameToId } = mapResolvedCharacters([
      {
        name: "白衣女子",
        aliases: ["女子", "她", "施主"],
        role: "protagonist",
        description: "携木匣回到寒山寺的主线行动者。",
        traits: ["清冷", "克制"],
        arc: "从送回遗物转为继续追查旧案。",
        confidence: "high",
        evidence: [
          {
            chapter_index: 1,
            chapter_title: "第一章 寒山寺",
            paragraph_start: 2,
            paragraph_end: 2,
            excerpt: "一个白衣女子撑伞而出。",
          },
        ],
      },
    ]);

    expect(characters[0].name).toBe("白衣女子");
    expect(characters[0].aliases).toContain("她");
    expect(characters[0].confidence).toBe("high");
    expect(characters[0].evidence?.[0].chapter_index).toBe(1);
    expect(nameToId.get("白衣女子")).toBe(characters[0].id);
    expect(nameToId.get("施主")).toBe(characters[0].id);
  });
});
