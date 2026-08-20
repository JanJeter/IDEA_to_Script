import type { ModelMessage } from 'ai';

export type AgentFinishReason =
  | 'submitted'
  | 'step_limit'
  | 'context_limit'
  | 'token_limit'
  | 'tool_limit'
  | 'timeout'
  | 'cancelled'
  | 'loop_detected'
  | 'retry_budget_exhausted'
  | 'provider_error';

export interface AgentBudget {
  maxSteps: number;
  maxContextTokens: number;
  maxCumulativeTokens: number;
  maxOutputTokensPerStep: number;
  maxProviderAttemptsPerStep: number;
  maxTotalProviderCalls: number;
  maxToolCalls: number;
  maxElapsedMs: number;
}

export interface AgentCapabilities {
  projectId: string;
  versionId: string;
  stage: string;
  allowedTools: readonly string[];
  readableStages: readonly string[];
  writableStages: readonly string[];
}

export interface AgentRunContext {
  runId: string;
  jobId: string;
  projectId: string;
  versionId: string;
  stage: string;
  workflowState: string;
  skillName: string;
  skillVersion: string;
  capabilities: AgentCapabilities;
  budget: AgentBudget;
}

export interface AgentStepUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
}

export interface AgentModelStepResult {
  messages: ModelMessage[];
  toolCalls: AgentToolCall[];
  usage: AgentStepUsage;
  durationMs: number;
}

export interface AgentModelStepInput {
  system: string;
  messages: ModelMessage[];
  tools: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
}

export interface AgentModelPort {
  readonly modelId: string;
  readonly available: boolean;
  executeStep(input: AgentModelStepInput): Promise<AgentModelStepResult>;
}

export interface AgentRunResult {
  finishReason: AgentFinishReason;
  steps: number;
  toolCalls: number;
  providerCalls: number;
  retries: number;
  promptTokens: number;
  completionTokens: number;
  cachedInputTokens: number;
  providerDurationMs: number;
}

export type AgentTraceEvent =
  | {
      type: 'run_started';
      runId: string;
      projectId: string;
      stage: string;
      model: string;
      skill: string;
      timestamp: string;
    }
  | {
      type: 'step_completed';
      runId: string;
      step: number;
      providerCalls: number;
      toolCalls: number;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      timestamp: string;
    }
  | {
      type: 'provider_retry';
      runId: string;
      step: number;
      attempt: number;
      reason: string;
      delayMs: number;
      timestamp: string;
    }
  | {
      type: 'run_finished';
      runId: string;
      reason: AgentFinishReason;
      steps: number;
      providerCalls: number;
      toolCalls: number;
      promptTokens: number;
      completionTokens: number;
      durationMs: number;
      timestamp: string;
    };

export interface AgentTraceSink {
  record(event: AgentTraceEvent): void | Promise<void>;
}

export const noopAgentTraceSink: AgentTraceSink = {
  record: () => undefined,
};
