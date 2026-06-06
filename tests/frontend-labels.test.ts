import { describe, it, expect } from "vitest";
import type { TimelineNode } from "../lib/types";
import {
  TIME_CN,
  ROLE_CN,
  FORMAT_CN,
  PACE_CN,
  STRATEGY_CN,
  CONFIDENCE_LEVEL,
} from "../app/components/labels";
import { sortTimelineByOrder } from "../app/components/timeline-utils";

describe("枚举中文标签映射", () => {
  it("TIME_CN 覆盖全部 7 个时段且为非空中文", () => {
    const keys = ["dawn", "morning", "noon", "afternoon", "evening", "night", "unspecified"];
    expect(Object.keys(TIME_CN).sort()).toEqual([...keys].sort());
    for (const v of Object.values(TIME_CN)) expect(v.length).toBeGreaterThan(0);
  });

  it("ROLE_CN 覆盖全部 6 种角色定位", () => {
    expect(Object.keys(ROLE_CN).sort()).toEqual(
      ["protagonist", "antagonist", "supporting", "minor", "narrator", "unknown"].sort(),
    );
    expect(ROLE_CN.protagonist).toBe("主角");
  });

  it("FORMAT_CN 覆盖全部 6 种载体", () => {
    expect(Object.keys(FORMAT_CN)).toHaveLength(6);
    expect(FORMAT_CN.drama).toBe("戏剧");
  });

  it("PACE_CN 覆盖全部 4 种节奏", () => {
    expect(Object.keys(PACE_CN).sort()).toEqual(
      ["slow", "medium", "fast", "unspecified"].sort(),
    );
  });

  it("STRATEGY_CN 覆盖全部 5 种改编策略", () => {
    expect(Object.keys(STRATEGY_CN).sort()).toEqual(
      ["faithful", "compressed", "merged", "rewritten", "inferred"].sort(),
    );
  });

  it("CONFIDENCE_LEVEL 将置信度映射为 1–3", () => {
    expect(CONFIDENCE_LEVEL).toEqual({ high: 3, medium: 2, low: 1 });
  });
});

describe("sortTimelineByOrder", () => {
  const make = (id: string, order: number): TimelineNode => ({ id, order, label: id });

  it("按 order 升序排列", () => {
    const input = [make("c", 2), make("a", 0), make("b", 1)];
    expect(sortTimelineByOrder(input).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("不可变：不修改入参数组", () => {
    const input = [make("c", 2), make("a", 0)];
    const snapshot = input.map((n) => n.id);
    sortTimelineByOrder(input);
    expect(input.map((n) => n.id)).toEqual(snapshot);
  });

  it("空数组返回空数组", () => {
    expect(sortTimelineByOrder([])).toEqual([]);
  });
});
