// 枚举值 → 中文标签。集中维护，供各展示组件复用。

import type { TimeOfDay, Character, Screenplay, Scene, SceneAdaptation } from "@/lib/types";

export const TIME_CN: Record<TimeOfDay, string> = {
  dawn: "拂晓",
  morning: "清晨",
  noon: "正午",
  afternoon: "午后",
  evening: "黄昏",
  night: "夜",
  unspecified: "未定",
};

export const ROLE_CN: Record<NonNullable<Character["role"]>, string> = {
  protagonist: "主角",
  antagonist: "对手",
  supporting: "配角",
  minor: "次要",
  narrator: "旁白",
  unknown: "未知",
};

export const FORMAT_CN: Record<Screenplay["metadata"]["format"], string> = {
  film: "电影",
  tv: "电视剧",
  short: "短剧",
  stage: "舞台剧",
  radio: "广播剧",
  drama: "戏剧",
};

export const PACE_CN: Record<NonNullable<Scene["pace"]>, string> = {
  slow: "慢",
  medium: "中速",
  fast: "快",
  unspecified: "未定",
};

export const STRATEGY_CN: Record<SceneAdaptation["strategy"], string> = {
  faithful: "忠实",
  compressed: "压缩",
  merged: "合并",
  rewritten: "重写",
  inferred: "推断",
};

export const CONFIDENCE_LEVEL: Record<NonNullable<Character["confidence"]>, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
