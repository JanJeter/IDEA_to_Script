export type StepStatus = "idle" | "running" | "done" | "failed";

export interface StepDef {
  key: string;
  label: string;
}

export interface StepState {
  status: StepStatus;
  detail: string;
}

interface StepperProps {
  steps: StepDef[];
  stepState: Record<string, StepState>;
}

const ICON: Record<StepStatus, string> = {
  idle: "",
  running: "·",
  done: "✓",
  failed: "!",
};

/** 状态的文本替代，供屏幕阅读器朗读（不依赖颜色 / 字形）。 */
const STATUS_CN: Record<StepStatus, string> = {
  idle: "待处理",
  running: "进行中",
  done: "已完成",
  failed: "失败",
};

/** 转换管线进度条：逐步展示七步状态。纯展示组件。 */
export default function Stepper({ steps, stepState }: StepperProps) {
  const doneCount = steps.filter((s) => stepState[s.key]?.status === "done").length;

  return (
    <section className="panel">
      <h2>
        转换管线 <span className="count">{doneCount} / {steps.length}</span>
      </h2>
      <ol className="steps">
        {steps.map((step) => {
          const state = stepState[step.key] ?? { status: "idle" as StepStatus, detail: "" };
          return (
            <li
              className={state.status}
              key={step.key}
              aria-current={state.status === "running" ? "step" : undefined}
            >
              <span className={`ico ${state.status}`} aria-hidden="true">
                {ICON[state.status]}
              </span>
              <span className="lbl">{step.label}</span>
              <span className="sr-only">：{STATUS_CN[state.status]}</span>
              {state.detail ? <small title={state.detail}>{state.detail}</small> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
