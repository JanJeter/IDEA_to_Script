import type { TimelineNode } from "@/lib/types";
import { TIME_CN } from "./labels";
import { sortTimelineByOrder } from "./timeline-utils";

interface TimelinePanelProps {
  timeline: TimelineNode[];
}

/** 时间线视图：按 order 排序的故事时间节点，串联相关场次。 */
export default function TimelinePanel({ timeline }: TimelinePanelProps) {
  const nodes = sortTimelineByOrder(timeline);

  return (
    <div className="view timeline">
      <div className="tl">
        {nodes.map((node) => (
          <div className="node" key={node.id}>
            <div className="when">
              {node.label}
              {node.time_of_day ? ` · ${TIME_CN[node.time_of_day]}` : ""}
            </div>
            {node.description ? <div className="what">{node.description}</div> : null}
            {node.related_scenes && node.related_scenes.length ? (
              <div className="ref">↳ {node.related_scenes.join("、")}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
