"use client";

import { useState } from "react";

type StepKey = "source_review" | "parse" | "analyze" | "aggregate" | "scenes" | "validate" | "screenplay_review";
type StepStatus = "idle" | "running" | "done" | "failed";

const steps: { key: StepKey; label: string }[] = [
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
) as Record<StepKey, { status: StepStatus; detail: string }>;

export default function Page() {
  const [novel, setNovel] = useState("");
  const [yaml, setYaml] = useState("");
  const [status, setStatus] = useState("等待开始");
  const [message, setMessage] = useState("");
  const [loadingSample, setLoadingSample] = useState(false);
  const [converting, setConverting] = useState(false);
  const [stepState, setStepState] = useState(initialStepState);

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
      setYaml("");
      setStatus("示例已载入");
      setStepState(initialStepState);
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
    setYaml("");
    setMessage("");
    setStatus("转换中");
    setStepState(initialStepState);

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
          const event = JSON.parse(line);

          if (event.type === "step") {
            setStepState((current) => ({
              ...current,
              [event.key]: {
                status: event.status,
                detail: event.detail || "",
              },
            }));
            setStatus(event.label);
          }

          if (event.type === "result") {
            setYaml(event.yaml);
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
    setMessage("YAML 已复制");
  }

  function downloadYaml() {
    if (!yaml) return;
    // 如果当前还没有生成 YAML，就直接退出，不下载。
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    // 创建 a 标签
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

    setMessage(payload.data.valid ? "Schema 校验通过" : `Schema 校验失败：${payload.data.errors.length} 处错误`);
  }

  return (
    <main className="app">
      <section className="pane">
        <header className="paneHead">
          <h2>小说输入</h2>
          <span>{novel.length} 字</span>
        </header>

        <textarea
          value={novel}
          onChange={(event) => setNovel(event.target.value)}
          placeholder="在这里粘贴至少 3 章小说内容"
        />

        <footer className="toolbar">
          <button onClick={loadSample} disabled={loadingSample || converting}>
            {loadingSample ? "载入中" : "载入示例"}
          </button>
          <button onClick={startConvert} disabled={!novel.trim() || converting}>
            {converting ? "转换中" : "开始转换"}
          </button>
          <button onClick={() => setNovel("")} disabled={converting}>
            清空
          </button>
        </footer>
      </section>

      <section className="pane">
        <header className="paneHead">
          <h2>转换进度</h2>
          <span>{status}</span>
        </header>

        <ol className="steps">
          {steps.map((step) => {
            const state = stepState[step.key];
            return (
              <li className={state.status} key={step.key}>
                <span>{step.label}</span>
                {state.detail ? <small>{state.detail}</small> : null}
              </li>
            );
          })}
        </ol>

        {message ? <p className="message">{message}</p> : null}
      </section>

      <section className="pane">
        <header className="paneHead">
          <h2>YAML 剧本</h2>
          <span>{yaml ? "已生成" : "未生成"}</span>
        </header>

        <pre className={yaml ? "yaml" : "empty"}>{yaml || "转换后的 YAML 会显示在这里"}</pre>

        <footer className="toolbar">
          <button onClick={copyYaml} disabled={!yaml}>
            复制 YAML
          </button>
          <button onClick={downloadYaml} disabled={!yaml}>
            下载 YAML
          </button>
          <button onClick={validateYaml} disabled={!yaml}>
            校验 Schema
          </button>
        </footer>
      </section>
    </main>
  );
}
