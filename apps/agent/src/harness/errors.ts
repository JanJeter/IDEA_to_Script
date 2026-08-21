import type { AgentFinishReason, AgentRunResult } from '../contracts/agent.types';

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFinishReason,
    readonly originalError?: unknown,
    telemetry?: AgentRunResult,
  ) {
    super(message);
    this.name = 'AgentExecutionError';
    this.telemetry = telemetry;
  }

  telemetry?: AgentRunResult;
}

export class ToolInputValidationError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: unknown,
  ) {
    super(`Invalid input for Agent tool ${toolName}`);
    this.name = 'ToolInputValidationError';
  }
}
