import type { Screenplay, Scene, SceneElement } from "@/lib/types";
import { TIME_CN, PACE_CN, STRATEGY_CN } from "./labels";

interface ScreenplayViewProps {
  screenplay: Screenplay;
}

function ElementBlock({ el }: { el: SceneElement }) {
  if (el.type === "narration") return <p className="el narration">{el.text}</p>;
  if (el.type === "action") return <p className="el action">{el.text}</p>;
  if (el.type === "transition")
    return <p className="transition">{el.text} →</p>;

  // dialogue
  return (
    <div className="el dialogue">
      <div className="cue">
        {el.character_name ?? "—"}
        {el.emotion ? <span className="emo">{el.emotion}</span> : null}
      </div>
      {el.parenthetical ? <div className="paren">{el.parenthetical}</div> : null}
      <div className="line">{el.text}</div>
    </div>
  );
}

function SceneMeta({ scene, locationName }: { scene: Scene; locationName?: string }) {
  const items: { label: string; value: string }[] = [];
  if (locationName) items.push({ label: "地点", value: locationName });
  if (scene.time) items.push({ label: "时间", value: TIME_CN[scene.time] });
  if (scene.mood) items.push({ label: "情绪", value: scene.mood });
  if (scene.pace) items.push({ label: "节奏", value: PACE_CN[scene.pace] });
  if (scene.conflict) items.push({ label: "冲突", value: scene.conflict });
  if (!items.length) return null;
  return (
    <div className="scene-meta">
      {items.map((item) => (
        <span key={item.label}>
          {item.label} <b>{item.value}</b>
        </span>
      ))}
    </div>
  );
}

function Annotation({ scene }: { scene: Scene }) {
  const ad = scene.adaptation;
  const excerpt = scene.source_refs?.[0]?.excerpt;
  if (!ad && !excerpt) return null;
  return (
    <div className="annot">
      {ad ? (
        <>
          <span className="tag">改编 · {STRATEGY_CN[ad.strategy] ?? ad.strategy}</span>{" "}
          {ad.ai_edits.map((edit, i) => (
            <span className="edit" key={i}>
              · {edit.note}
              {edit.source_ref ? <code> {edit.source_ref}</code> : null}
            </span>
          ))}
        </>
      ) : null}
      {excerpt ? <span className="src">溯源：{excerpt}</span> : null}
    </div>
  );
}

/** 台本视图：把每一场渲染为真实剧本排版（场头 / 元信息 / 元素 / 改编边注）。 */
export default function ScreenplayView({ screenplay }: ScreenplayViewProps) {
  const locName = new Map(screenplay.locations.map((l) => [l.id, l.name]));

  return (
    <div className="view">
      {screenplay.scenes.map((scene, idx) => (
        <article className="scene" key={scene.id}>
          <div className="slug-row">
            <span className="scene-no">
              SCENE {String(idx + 1).padStart(2, "0")} · {scene.id}
            </span>
          </div>
          <h4 className="heading">{scene.heading}</h4>
          <SceneMeta
            scene={scene}
            locationName={scene.location_id ? locName.get(scene.location_id) : undefined}
          />
          {scene.elements.map((el, i) => (
            <ElementBlock el={el} key={i} />
          ))}
          <Annotation scene={scene} />
        </article>
      ))}
    </div>
  );
}
