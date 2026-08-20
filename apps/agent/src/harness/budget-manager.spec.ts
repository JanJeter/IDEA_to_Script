import type { AgentBudget } from '../contracts/agent.types';
import { AgentBudgetManager } from './budget-manager';

const budget: AgentBudget = {
  maxSteps: 2,
  maxContextTokens: 1_000,
  maxCumulativeTokens: 350,
  maxOutputTokensPerStep: 200,
  maxProviderAttemptsPerStep: 2,
  maxTotalProviderCalls: 4,
  maxToolCalls: 4,
  maxElapsedMs: 5_000,
};

describe('AgentBudgetManager', () => {
  it('tracks cached input without counting it twice in the cumulative budget', () => {
    const manager = new AgentBudgetManager(budget);
    manager.recordStep(
      { inputTokens: 300, outputTokens: 40, cachedInputTokens: 250 },
      20,
    );

    expect(manager.snapshot).toMatchObject({
      promptTokens: 300,
      completionTokens: 40,
      cachedInputTokens: 250,
    });
    expect(() => manager.assertCanContinue()).not.toThrow();
  });
});
