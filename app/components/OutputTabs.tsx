"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { Screenplay } from "@/lib/types";
import type { ValidationResult } from "@/lib/schema";
import { FORMAT_CN } from "./labels";
import ScreenplayView from "./ScreenplayView";
import CharacterPanel from "./CharacterPanel";
import TimelinePanel from "./TimelinePanel";
import AdaptationPanel from "./AdaptationPanel";

type TabKey = "script" | "cast" | "timeline" | "adapt" | "yaml";

interface OutputTabsProps {
  screenplay: Screenplay;
  yaml: string;
  validation: ValidationResult | null;
  onCopy: () => void;
  onDownload: () => void;
  onValidate: () => void;
}

/** 把 YAML 文本按行渲染为带 key 着色的只读视图（不使用 dangerouslySetInnerHTML）。 */
function YamlBlock({ yaml }: { yaml: string }) {
  return (
    <pre className="yaml view">
      {yaml.split("\n").map((line, i) => {
        const match = line.match(/^(\s*)(- )?([A-Za-z0-9_]+):(.*)$/);
        if (!match) return <span key={i}>{line + "\n"}</span>;
        const [, indent, dash, key, rest] = match;
        return (
          <span key={i}>
            {indent}
            {dash ? <span className="dash">{dash}</span> : null}
            <span className="k">{key}</span>
            {":" + rest + "\n"}
          </span>
        );
      })}
    </pre>
  );
}

export default function OutputTabs({
  screenplay,
  yaml,
  validation,
  onCopy,
  onDownload,
  onValidate,
}: OutputTabsProps) {
  const [tab, setTab] = useState<TabKey>("script");

  const { metadata, source } = screenplay;
  const adaptCount = (screenplay.adaptation_notes?.length ?? 0) + (screenplay.open_questions?.length ?? 0);

  const tabs: { key: TabKey; label: string; n?: number }[] = [
    { key: "script", label: "台本", n: screenplay.scenes.length },
    { key: "cast", label: "人物", n: screenplay.characters.length },
    { key: "timeline", label: "时间线", n: screenplay.timeline.length },
    { key: "adapt", label: "改编 / 待确认", n: adaptCount },
    { key: "yaml", label: "YAML" },
  ];

  // 标签栏遵循 WAI-ARIA Tabs 模式：roving tabindex + 箭头/Home/End 键导航。
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activateTab(index: number) {
    const next = tabs[index];
    if (!next) return;
    setTab(next.key);
    tabRefs.current[index]?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const count = tabs.length;
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + count) % count;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    activateTab(nextIndex);
  }

  return (
    <>
      <div className="frontmatter">
        <span className="kicker">Screenplay · 剧本初稿</span>
        <h3>{metadata.title}</h3>
        {metadata.logline ? <p className="logline">{metadata.logline}</p> : null}
        <div className="chips">
          {(metadata.genre ?? []).map((g) => (
            <span className="chip" key={g}>
              {g}
            </span>
          ))}
          <span className="chip accent">format: {FORMAT_CN[metadata.format]}</span>
          <span className="chip accent">{metadata.language}</span>
          <span className="chip">
            原作《{source.novel_title}》· {source.chapter_count} 章
          </span>
          {validation ? (
            <span className={`chip ${validation.valid ? "accent" : "warn"}`}>
              {validation.valid ? "Schema ✓ 校验通过" : `Schema ✕ ${validation.errors.length} 处错误`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="剧本视图">
        {tabs.map((t, i) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              id={`tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${t.key}`}
              tabIndex={active ? 0 : -1}
              className={`tab ${active ? "active" : ""}`}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => onTabKeyDown(event, i)}
            >
              {t.label}
              {t.n !== undefined ? <span className="n">{t.n}</span> : null}
            </button>
          );
        })}
      </div>

      <div
        className="tabbody"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === "script" && <ScreenplayView screenplay={screenplay} />}
        {tab === "cast" && <CharacterPanel characters={screenplay.characters} />}
        {tab === "timeline" && <TimelinePanel timeline={screenplay.timeline} />}
        {tab === "adapt" && (
          <AdaptationPanel
            notes={screenplay.adaptation_notes ?? []}
            questions={screenplay.open_questions ?? []}
          />
        )}
        {tab === "yaml" && <YamlBlock yaml={yaml} />}
      </div>

      <div className="actions">
        <button className="btn primary" onClick={onCopy} disabled={!yaml}>
          复制 YAML
        </button>
        <button className="btn" onClick={onDownload} disabled={!yaml}>
          下载 .yaml
        </button>
        <button className="btn" onClick={onValidate} disabled={!yaml}>
          校验 Schema
        </button>
      </div>
    </>
  );
}
