import { describe, expect, it } from "vitest";
import { normalizeSafetyReviewOutput, reviewContentSafety } from "../lib/ai";

describe("content safety review", () => {
  it("规范化 PASS 输出", () => {
    expect(normalizeSafetyReviewOutput("PASS")).toBe("PASS");
    expect(normalizeSafetyReviewOutput("PASS\n已通过")).toBe("PASS");
  });

  it("规范化 BLOCK 输出并兼容中文冒号", () => {
    expect(normalizeSafetyReviewOutput("BLOCK：包含违法违规内容")).toBe("BLOCK: 包含违法违规内容");
    expect(normalizeSafetyReviewOutput("BLOCK: 包含暴力风险")).toBe("BLOCK: 包含暴力风险");
  });

  it("mock 模式命中风险词时返回 BLOCK", async () => {
    const previous = process.env.USE_MOCK;
    process.env.USE_MOCK = "1";
    try {
      const result = await reviewContentSafety({
        target: "source",
        content: "这段文本包含爆炸物制作等违法违规指导。",
      });

      expect(result.startsWith("BLOCK:")).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.USE_MOCK;
      } else {
        process.env.USE_MOCK = previous;
      }
    }
  });
});
