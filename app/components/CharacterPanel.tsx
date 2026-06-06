import type { Character } from "@/lib/types";
import { ROLE_CN, CONFIDENCE_LEVEL } from "./labels";

interface CharacterPanelProps {
  characters: Character[];
}

function ConfidenceMeter({ confidence }: { confidence: Character["confidence"] }) {
  if (!confidence) return null;
  const level = CONFIDENCE_LEVEL[confidence];
  return (
    <div className="conf">
      归一置信度
      <span className="meter">
        {[1, 2, 3].map((i) => (
          <i className={i <= level ? "on" : ""} key={i} />
        ))}
      </span>
      {confidence}
    </div>
  );
}

/** 人物表：角色定位 / 特质 / 弧光 / 归一置信度。 */
export default function CharacterPanel({ characters }: CharacterPanelProps) {
  return (
    <div className="view grid">
      {characters.map((c) => (
        <div className="card" key={c.id}>
          {c.role ? <span className={`role ${c.role}`}>{ROLE_CN[c.role]}</span> : null}
          <div className="name">
            {c.name}
            {c.aliases && c.aliases.length ? (
              <span className="alias">又称 {c.aliases.join("、")}</span>
            ) : null}
          </div>
          {c.description ? <p className="desc">{c.description}</p> : null}
          {c.traits && c.traits.length ? (
            <div className="traits">
              {c.traits.map((t) => (
                <span className="trait" key={t}>
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          {c.arc ? (
            <div className="arc">
              <b>人物弧光 Arc</b>
              {c.arc}
            </div>
          ) : null}
          <ConfidenceMeter confidence={c.confidence} />
        </div>
      ))}
    </div>
  );
}
