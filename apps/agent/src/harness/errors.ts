import type { AgentFinishReason } from '../contracts/agent.types';

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly reason: AgentFinishReason,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'AgentExecutionError';
  }
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
