import type { ModelMessage } from 'ai';
import type { StageKey } from '../../generation/generation.types';

export interface StageAgentRunContext {
  runId: string;
  jobId: string;
  projectId: string;
  versionId: string;
  visitorId: string;
  stage: StageKey;
  workflowState: string;
  skillName: string;
  skillVersion: string;
  allowedTools: readonly string[];
  lockedStages: readonly StageKey[];
  maxSteps: number;
  tokenBudget: number;
  timeoutMs: number;
}

export interface AgentToolCall {
  name: string;
  input: unknown;
}

export interface AgentStepUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AgentModelStepResult {
  messages: ModelMessage[];
  toolCalls: AgentToolCall[];
  usage: AgentStepUsage;
}

export type StageAgentFinishReason =
  | 'submitted'
  | 'step_limit'
  | 'token_limit'
  | 'timeout'
  | 'loop_detected';

export interface StageAgentResult {
  finishReason: StageAgentFinishReason;
  steps: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
}

