"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type StepStatus = "pending" | "running" | "done" | "failed";
interface StepView {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}
interface ValidationError {
  path: string;
  message: string;
  keyword: string;
}
interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

const INITIAL_STEPS: StepView[] = [
  { key: "parse", label: "章节解析", status: "pending" },
  { key: "analyze", label: "章节级分析", status: "pending" },
  { key: "aggregate", label: "人物/世界观汇总", status: "pending" },
  { key: "scenes", label: "分场剧本生成", status: "pending" },
  { key: "validate", label: "Schema 校验", status: "pending" },
];

type OverallStatus = "idle" | "running" | "done" | "failed";

const STATUS_TEXT: Record<OverallStatus, string> = {
  idle: "等待输入：在左侧粘贴 3 章以上小说，点击「开始转换」。",
  running: "处理中…",
  done: "完成。可在右侧复制 / 下载 / 校验 YAML。",
  failed: "失败，请查看错误提示。",
};

export default function Page() {
  const [novel, setNovel] = useState("");
  const [chapterCount, setChapterCount] = useState<number | null>(null);
  const [parseHint, setParseHint] = useState<string>("");
  const [steps, setSteps] = useState<StepView[]>(INITIAL_STEPS);
  const [status, setStatus] = useState<OverallStatus>("idle");
  const [error, setError] = useState<string>("");
  const [yaml, setYaml] = useState<string>("");
  const [mode, setMode] = useState<"ai" | "mock" | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [manualValidation, setManualValidation] = useState<ValidationResult | null>(null);
  const [chapters, setChapters] = useState<{ index: number; title: string; summary?: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // —— 输入区实时章节预览（防抖）——
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!novel.trim()) {
      setChapterCount(null);
      setParseHint("");
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: novel }),
        });
        const json = await res.json();
        if (json.success) {
          setChapterCount(json.data.chapterCount);
          setParseHint("");
        } else {
          setChapterCount(null);
          setParseHint(json.error);
        }
      } catch {
        /* 预览失败忽略 */
      }
    }, 500);
  }, [novel]);

  const loadSample = useCallback(async () => {
    const res = await fetch("/api/sample");
    const json = await res.json();
    if (json.success) setNovel(json.data.text);
  }, []);

  const handleConvert = useCallback(async () => {
    setStatus("running");
    setError("");
    setYaml("");
    setValidation(null);
    setManualValidation(null);
    setChapters([]);
    setMode(null);
    setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "pending", detail: undefined })));

    const setStep = (key: string, status: StepStatus, detail?: string) =>
      setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail } : s)));

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: novel }),
      });
      if (!res.body) throw new Error("无响应流");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let failed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "step") {
            setStep(ev.key, ev.status, ev.detail);
          } else if (ev.type === "result") {
            setYaml(ev.yaml);
            setValidation(ev.validation);
            setMode(ev.mode);
            setChapters(ev.chapters);
          } else if (ev.type === "error") {
            failed = true;
            setError(ev.message);
          }
        }
      }
      setStatus(failed ? "failed" : "done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "转换失败");
      setStatus("failed");
    }
  }, [novel]);

  const copyYaml = useCallback(async () => {
    if (!yaml) return;
    await navigator.clipboard.writeText(yaml);
  }, [yaml]);

  const downloadYaml = useCallback(() => {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "screenplay.yaml";
    a.click();
    URL.revokeObjectURL(url);
  }, [yaml]);

  const validateYaml = useCallback(async () => {
    if (!yaml) return;
    const res = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml }),
    });
    const json = await res.json();
    if (json.success) setManualValidation(json.data);
  }, [yaml]);

  const activeValidation = manualValidation ?? validation;
  const canConvert = status !== "running" && novel.trim().length > 0;

  return (
    <div className="app">
      <header className="topbar">
        <h1>AI 小说转剧本</h1>
        <span className="sub">小说 → 结构化 YAML 剧本初稿</span>
        {mode && <span className="mode">{mode === "ai" ? "AI 模式" : "MOCK 模式"}</span>}
      </header>

      <div className="panes">
        {/* 左：输入 */}
        <section className="pane">
          <div className="pane-head">
            <span className="label">① 小说输入</span>
            <span className="hint">至少 3 个章节（第N章 / 序章 / Chapter N）</span>
          </div>
          <div className="pane-body">
            <textarea
              className="novel"
              value={novel}
              onChange={(e) => setNovel(e.target.value)}
              placeholder={"在此粘贴小说，例如：\n\n第一章 风雪夜\n沈砚推门而入……\n\n第二章 旧识\n……"}
            />
          </div>
          <div className="chapter-meta" style={{ padding: "0 16px 6px" }}>
            {chapterCount !== null && (
              <span>
                已识别 <strong>{chapterCount}</strong> 个章节{chapterCount < 3 ? "（不足 3 章，无法转换）" : ""}
              </span>
            )}
            {parseHint && <span style={{ color: "var(--accent)" }}>{parseHint}</span>}
          </div>
          <div className="toolbar">
            <button className="btn primary" onClick={handleConvert} disabled={!canConvert}>
              开始转换
            </button>
            <button className="btn" onClick={loadSample} disabled={status === "running"}>
              载入示例
            </button>
            <button className="btn" onClick={() => setNovel("")} disabled={status === "running"}>
              清空
            </button>
          </div>
        </section>

        {/* 中：进度与分析 */}
        <section className="pane">
          <div className="pane-head">
            <span className="label">② 转换进度</span>
            <span className="hint">五步管线</span>
          </div>
          <div className="pane-body">
            <ul className="steps">
              {steps.map((s) => (
                <li key={s.key} className={`step ${s.status}`}>
                  <span className="dot">
                    {s.status === "done" ? "✓" : s.status === "failed" ? "!" : s.status === "running" ? "…" : ""}
                  </span>
                  <span className="body">
                    <span className="name">{s.label}</span>
                    {s.detail && <span className="detail">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>

            <div className={`statusline ${status}`}>{STATUS_TEXT[status]}</div>
            {error && <div className="errorbox">{error}</div>}

            {chapters.length > 0 && (
              <div className="analysis-card">
                <h4>章节摘要</h4>
                {chapters.map((c) => (
                  <div key={c.index} style={{ marginBottom: 6 }}>
                    <span className="tag">{c.title}</span>
                    <div>{c.summary}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 右：YAML 输出 */}
        <section className="pane">
          <div className="pane-head">
            <span className="label">③ YAML 剧本</span>
            {activeValidation && (
              <span className={`validate-badge ${activeValidation.valid ? "ok" : "bad"}`}>
                {activeValidation.valid ? "Schema 通过" : `Schema ${activeValidation.errors.length} 处错误`}
              </span>
            )}
          </div>
          <div className="pane-body">
            {yaml ? (
              <>
                <pre className="yaml">{yaml}</pre>
                {activeValidation && !activeValidation.valid && (
                  <ul className="errors-list">
                    {activeValidation.errors.map((e, i) => (
                      <li key={i}>
                        <span className="path">{e.path}</span> — {e.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <div className="empty">
                转换后的 YAML 剧本将显示在这里。
                <br />
                未配置 API Key 时自动使用 MOCK 模式。
              </div>
            )}
          </div>
          <div className="toolbar">
            <button className="btn" onClick={copyYaml} disabled={!yaml}>
              复制 YAML
            </button>
            <button className="btn" onClick={downloadYaml} disabled={!yaml}>
              下载 YAML
            </button>
            <button className="btn" onClick={validateYaml} disabled={!yaml}>
              校验 Schema
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
