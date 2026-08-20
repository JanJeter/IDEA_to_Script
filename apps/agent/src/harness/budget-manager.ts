import type { AgentBudget, AgentStepUsage } from '../contracts/agent.types';
import { AgentExecutionError } from './errors';

const positiveInteger = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
};

export function assertAgentBudget(budget: AgentBudget) {
  positiveInteger(budget.maxSteps, 'maxSteps');
  positiveInteger(budget.maxContextTokens, 'maxContextTokens');
  positiveInteger(budget.maxCumulativeTokens, 'maxCumulativeTokens');
  positiveInteger(budget.maxOutputTokensPerStep, 'maxOutputTokensPerStep');
  positiveInteger(budget.maxProviderAttemptsPerStep, 'maxProviderAttemptsPerStep');
  positiveInteger(budget.maxTotalProviderCalls, 'maxTotalProviderCalls');
  positiveInteger(budget.maxToolCalls, 'maxToolCalls');
  positiveInteger(budget.maxElapsedMs, 'maxElapsedMs');
  if (budget.maxSteps > 30) throw new Error('maxSteps cannot exceed 30');
  if (budget.maxProviderAttemptsPerStep > 4) {
    throw new Error('maxProviderAttemptsPerStep cannot exceed 4');
  }
}

export class AgentBudgetManager {
  private prompt = 0;
  private completion = 0;
  private cached = 0;
  private providerCallCount = 0;
  private retryCount = 0;
  private providerMs = 0;

  constructor(readonly limits: AgentBudget) {
    assertAgentBudget(limits);
  }

  assertContext(estimatedTokens: number) {
    if (estimatedTokens > this.limits.maxContextTokens) {
      throw new AgentExecutionError(
        `Agent context estimate ${estimatedTokens} exceeds ${this.limits.maxContextTokens}`,
        'context_limit',
      );
    }
  }

  beginProviderCall(isRetry: boolean) {
    if (this.providerCallCount >= this.limits.maxTotalProviderCalls) {
      throw new AgentExecutionError('Agent provider-call budget exhausted', 'retry_budget_exhausted');
    }
    this.providerCallCount += 1;
    if (isRetry) this.retryCount += 1;
  }

  recordStep(usage: AgentStepUsage, durationMs: number) {
    this.prompt += Math.max(0, usage.inputTokens || 0);
    this.completion += Math.max(0, usage.outputTokens || 0);
    this.cached += Math.max(0, usage.cachedInputTokens || 0);
    this.providerMs += Math.max(0, durationMs || 0);
  }

  assertCanContinue() {
    if (this.totalTokens > this.limits.maxCumulativeTokens) {
      throw new AgentExecutionError('Agent cumulative token budget exhausted', 'token_limit');
    }
  }

  get totalTokens() {
    // Provider input usage already includes the cached-input subset. Keep the
    // cache figure for observability, but do not charge it twice to the run.
    return this.prompt + this.completion;
  }

  get snapshot() {
    return {
      promptTokens: this.prompt,
      completionTokens: this.completion,
      cachedInputTokens: this.cached,
      providerCalls: this.providerCallCount,
      retries: this.retryCount,
      providerDurationMs: this.providerMs,
    };
  }
}
