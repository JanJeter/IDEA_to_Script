import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { validateScreenplay } from "../lib/schema";

function loadYaml(rel: string): unknown {
  return YAML.parse(readFileSync(path.join(process.cwd(), rel), "utf-8"));
}

describe("validateScreenplay", () => {
  it("sample-screenplay.yaml 通过校验", () => {
    const result = validateScreenplay(loadYaml("examples/sample-screenplay.yaml"));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("valid-example.yaml 通过校验", () => {
    const result = validateScreenplay(loadYaml("examples/valid-example.yaml"));
    expect(result.valid).toBe(true);
  });

  it("invalid-example.yaml 校验失败并报告多处错误", () => {
    const result = validateScreenplay(loadYaml("examples/invalid-example.yaml"));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("chapter_count < 3 被拒绝", () => {
    const bad = {
      metadata: { title: "x", format: "drama", language: "zh-CN" },
      source: { novel_title: "x", chapter_count: 2 },
      characters: [],
      locations: [],
      timeline: [],
      scenes: [{ id: "scene_1", heading: "h", elements: [{ type: "action", text: "t" }] }],
    };
    const result = validateScreenplay(bad);
    expect(result.valid).toBe(false);
  });
});
