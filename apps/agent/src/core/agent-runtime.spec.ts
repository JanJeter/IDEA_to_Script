import { z } from 'zod';
import type { AgentBudget, AgentRunContext } from '../contracts/agent.types';
import { AgentRetryPolicy } from '../harness/retry-policy';
import { AgentToolRegistry } from '../tools/tool-registry';
import { AgentRuntime } from './agent-runtime';

const budget: AgentBudget = {
  maxSteps: 4,
  maxContextTokens: 10_000,
  maxCumulativeTokens: 10_000,
  maxOutputTokensPerStep: 1_000,
  maxProviderAttemptsPerStep: 2,
  maxTotalProviderCalls: 8,
  maxToolCalls: 8,
  maxElapsedMs: 5_000,
};

const context: AgentRunContext = {
  runId: 'run-1',
  jobId: 'job-1',
  projectId: 'project-1',
  versionId: 'version-1',
  stage: 'PREMISE',
  workflowState: 'STAGING',
  skillName: 'premise',
  skillVersion: '1.0.0',
  capabilities: {
    projectId: 'project-1',
    versionId: 'version-1',
    stage: 'PREMISE',
    allowedTools: ['submit'],
    readableStages: [],
    writableStages: ['PREMISE'],
  },
  budget,
};

function submissionRegistry(onSubmit: () => void) {
  return new AgentToolRegistry(new Set(['submit']), budget.maxToolCalls).register({
    name: 'submit',
    description: 'submit',
    inputSchema: z.object({ value: z.string() }).strict(),
    execute: async () => {
      onSubmit();
      return { accepted: true };
    },
  });
}

describe('AgentRuntime', () => {
  it('requires an explicit stage write capability for mutating tools', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn(),
    };
    const runtime = new AgentRuntime(model);

    await expect(runtime.run({
      context: {
        ...context,
        capabilities: { ...context.capabilities, writableStages: [] },
      },
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => false,
    })).rejects.toThrow('write capability');
    expect(model.executeStep).not.toHaveBeenCalled();
  });

  it('finishes only after a submission tool accepts a draft', async () => {
    let submitted = false;
    const registry = submissionRegistry(() => { submitted = true; });
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn().mockImplementation(async ({ tools }) => {
        await tools.submit.execute({ value: 'draft' });
        return {
          messages: [],
          toolCalls: [{ name: 'submit', input: { value: 'draft' } }],
          usage: { inputTokens: 100, outputTokens: 40 },
          durationMs: 20,
        };
      }),
    };
    const runtime = new AgentRuntime(model);
    await expect(runtime.run({
      context,
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => submitted,
    })).resolves.toMatchObject({
      finishReason: 'submitted',
      steps: 1,
      toolCalls: 1,
      providerCalls: 1,
      promptTokens: 100,
      completionTokens: 40,
    });
  });

  it('separates per-request context limits from cumulative token limits', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn().mockResolvedValue({
        messages: [],
        toolCalls: [{ name: 'submit', input: { value: 'draft' } }],
        usage: { inputTokens: 300, outputTokens: 20 },
        durationMs: 10,
      }),
    };
    const runtime = new AgentRuntime(model);
    await expect(runtime.run({
      context: { ...context, budget: { ...budget, maxCumulativeTokens: 256 } },
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => false,
    })).rejects.toMatchObject({ reason: 'token_limit' });
  });

  it('accepts a submitted draft after the final call crosses the cumulative estimate', async () => {
    let submitted = false;
    const registry = submissionRegistry(() => { submitted = true; });
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn().mockImplementation(async ({ tools }) => {
        await tools.submit.execute({ value: 'draft' });
        return {
          messages: [],
          toolCalls: [{ name: 'submit', input: { value: 'draft' } }],
          usage: { inputTokens: 300, outputTokens: 20 },
          durationMs: 10,
        };
      }),
    };
    const runtime = new AgentRuntime(model);
    await expect(runtime.run({
      context: { ...context, budget: { ...budget, maxCumulativeTokens: 256 } },
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => submitted,
    })).resolves.toMatchObject({ finishReason: 'submitted', promptTokens: 300 });
  });

  it('retries only retryable provider failures within the Harness budget', async () => {
    let submitted = false;
    const registry = submissionRegistry(() => { submitted = true; });
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn()
        .mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('HTTP 503 unavailable');
        })
        .mockImplementationOnce(async ({ tools }) => {
          await tools.submit.execute({ value: 'draft' });
          return {
            messages: [],
            toolCalls: [{ name: 'submit', input: { value: 'draft' } }],
            usage: { inputTokens: 100, outputTokens: 40 },
            durationMs: 20,
          };
        }),
    };
    const runtime = new AgentRuntime(model, { retryPolicy: new AgentRetryPolicy(0, 0) });
    const result = await runtime.run({
      context,
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => submitted,
    });
    expect(result).toEqual(expect.objectContaining({
      providerCalls: 2,
      retries: 1,
      providerDurationMs: expect.any(Number),
    }));
    expect(result.providerDurationMs).toBeGreaterThan(20);
  });

  it('never retries an unknown stream outcome after a mutating tool call', async () => {
    let submitted = false;
    const registry = submissionRegistry(() => { submitted = true; });
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn().mockImplementation(async ({ tools }) => {
        await tools.submit.execute({ value: 'draft' });
        throw new Error('HTTP 503 after streamed tool result');
      }),
    };
    const runtime = new AgentRuntime(model, { retryPolicy: new AgentRetryPolicy(0, 0) });
    await expect(runtime.run({
      context,
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => submitted,
    })).rejects.toMatchObject({
      reason: 'provider_error',
      telemetry: expect.objectContaining({ providerCalls: 1, toolCalls: 1 }),
    });
    expect(model.executeStep).toHaveBeenCalledTimes(1);
  });

  it('does not call the provider when the external signal is already aborted', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn(),
    };
    const controller = new AbortController();
    controller.abort(new Error('cancel before run'));
    const runtime = new AgentRuntime(model);

    await expect(runtime.run({
      context,
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => false,
      signal: controller.signal,
    })).rejects.toMatchObject({
      reason: 'cancelled',
      telemetry: expect.objectContaining({ providerCalls: 0 }),
    });
    expect(model.executeStep).not.toHaveBeenCalled();
  });

  it('detects repeated tool calls before all steps are consumed', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      modelId: 'test-model',
      available: true,
      executeStep: jest.fn().mockResolvedValue({
        messages: [],
        toolCalls: [{ name: 'submit', input: { value: 'same' } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        durationMs: 1,
      }),
    };
    const runtime = new AgentRuntime(model);
    await expect(runtime.run({
      context,
      system: 'test',
      user: 'test',
      registry,
      hasSubmitted: () => false,
    })).rejects.toMatchObject({ reason: 'loop_detected' });
    expect(model.executeStep).toHaveBeenCalledTimes(3);
  });
});
