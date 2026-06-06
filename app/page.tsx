"use client";

import { useState } from "react";
import type { Screenplay } from "@/lib/types";
import type { ValidationResult } from "@/lib/schema";
import type { ConvertEvent } from "@/lib/pipeline";
import Stepper, { type StepDef, type StepState, type StepStatus } from "./components/Stepper";
import OutputTabs from "./components/OutputTabs";

const steps: StepDef[] = [
  { key: "source_review", label: "原文安全审核" },
  { key: "parse", label: "章节解析" },
  { key: "analyze", label: "章节分析" },
  { key: "aggregate", label: "人物 / 世界观汇总" },
  { key: "scenes", label: "分场剧本生成" },
  { key: "validate", label: "Schema 校验" },
  { key: "screenplay_review", label: "剧本安全审核" },
];

const initialStepState = Object.fromEntries(
  steps.map((step) => [step.key, { status: "idle" as StepStatus, detail: "" }]),
) as Record<string, StepState>;

type ConvertMode = "ai" | "mock";

export default function Page() {
  const [novel, setNovel] = useState("");
  const [screenplay, setScreenplay] = useState<Screenplay | null>(null);
  const [yaml, setYaml] = useState("");
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [mode, setMode] = useState<ConvertMode | null>(null);
  const [status, setStatus] = useState("等待开始");
  const [message, setMessage] = useState("");
  const [loadingSample, setLoadingSample] = useState(false);
  const [converting, setConverting] = useState(false);
  const [stepState, setStepState] = useState(initialStepState);

  function resetOutput() {
    setScreenplay(null);
    setYaml("");
    setValidation(null);
    setMode(null);
    setStepState(initialStepState);
  }

  async function loadSample() {
    setLoadingSample(true);
    setMessage("");
    try {
      const response = await fetch("/api/sample", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "示例读取失败");
      }
      setNovel(payload.data.text);
      resetOutput();
      setStatus("示例已载入");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "示例读取失败");
      setStatus("载入失败");
    } finally {
      setLoadingSample(false);
    }
  }

  async function startConvert() {
    if (!novel.trim() || converting) return;

    setConverting(true);
    resetOutput();
    setMessage("");
    setStatus("转换中");

    try {
      const response = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: novel }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "转换请求失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ConvertEvent;

          if (event.type === "step") {
            setStepState((current) => ({
              ...current,
              [event.key]: { status: event.status, detail: event.detail || "" },
            }));
            setStatus(event.label);
          }

          if (event.type === "result") {
            setScreenplay(event.screenplay);
            setYaml(event.yaml);
            setValidation(event.validation);
            setMode(event.mode);
            setStatus(event.validation?.valid ? "已生成" : "已生成，校验未通过");
          }

          if (event.type === "error") {
            throw new Error(event.message || "转换失败");
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "转换失败";
      setMessage(errorMessage);
      setStatus(errorMessage.startsWith("BLOCK:") ? "审核拦截" : "转换失败");
    } finally {
      setConverting(false);
    }
  }

  async function copyYaml() {
    if (!yaml) return;
    await navigator.clipboard.writeText(yaml);
    setMessage("YAML 已复制到剪贴板");
  }

  function downloadYaml() {
    if (!yaml) return;
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "screenplay.yaml";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function validateYaml() {
    if (!yaml) return;
    const response = await fetch("/api/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yaml }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) {
      setMessage(payload.error || "校验失败");
      return;
    }
    setMessage(
      payload.data.valid
        ? "Schema 校验通过"
        : `Schema 校验失败：${payload.data.errors.length} 处错误`,
    );
  }

  const badge = converting
    ? { cls: "busy", text: "转换中…" }
    : status === "转换失败" || status === "审核拦截" || status === "载入失败"
      ? { cls: "fail", text: status }
      : screenplay && mode
        ? { cls: "live", text: `${mode} 模式 · 已生成` }
        : { cls: "", text: status };

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="brandblock">
          <div className="seal">改</div>
          <div className="titles">
            <h1>小说转剧本工作台</h1>
            <p className="sub">Novel · to · Screenplay</p>
          </div>
        </div>
        <span className="mode" role="status" aria-live="polite">
          <span className={`dot ${badge.cls}`} aria-hidden="true" />
          {badge.text}
        </span>
      </header>

      <div className="workspace">
        <aside className="aside">
          <section className="panel">
            <h2>
              小说原文 <span className="count">{novel.length} 字</span>
            </h2>
            <div className="input-body">
              <textarea
                className="novel"
                value={novel}
                onChange={(event) => setNovel(event.target.value)}
                aria-label="小说原文"
                placeholder="在这里粘贴至少 3 章小说内容。每章以「第N章」「序章」「Chapter N」等标题独占一行。"
              />
              <div className="toolbar">
                <button className="btn" onClick={loadSample} disabled={loadingSample || converting}>
                  {loadingSample ? "载入中…" : "载入示例"}
                </button>
                <button
                  className="btn primary"
                  onClick={startConvert}
                  disabled={!novel.trim() || converting}
                >
                  {converting ? "转换中…" : "开始转换"}
                </button>
                <button className="btn" onClick={() => setNovel("")} disabled={converting}>
                  清空
                </button>
              </div>
              {message ? (
                <p className="message" role="status" aria-live="polite">
                  {message}
                </p>
              ) : null}
            </div>
          </section>

          <Stepper steps={steps} stepState={stepState} />
        </aside>

        <main className="panel output">
          {screenplay ? (
            <OutputTabs
              screenplay={screenplay}
              yaml={yaml}
              validation={validation}
              onCopy={copyYaml}
              onDownload={downloadYaml}
              onValidate={validateYaml}
            />
          ) : (
            <div className="placeholder">
              <div>
                <p className="big">转换后的结构化剧本将在这里呈现</p>
                <p className="hint">
                  左侧点击 <b>载入示例</b> → <b>开始转换</b>
                  <br />
                  无需 API Key 即可运行（自动进入 mock 模式）
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      <p className="footnote">— 墨·朱砂 · 小说转剧本工作台 · 结构化 / 可校验 / 可二次编辑 —</p>
    </div>
  );
}
