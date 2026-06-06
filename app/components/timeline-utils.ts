import type { TimelineNode } from "@/lib/types";

/**
 * 按 order 升序返回时间线节点的新数组（不可变：不修改入参）。
 * order 越小越早；故事时间可能与章节顺序不同，故以 order 为准。
 */
export function sortTimelineByOrder(timeline: TimelineNode[]): TimelineNode[] {
  return [...timeline].sort((a, b) => a.order - b.order);
}
