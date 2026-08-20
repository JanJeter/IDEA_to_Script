import { z } from 'zod';
import type { StageAgentRunContext } from '../contracts/stage-agent.types';
import { RunToolRegistry } from '../tools/run-tool.registry';
import {
  StageAgentExecutionError,
  StageAgentRuntimeService,
} from './stage-agent-runtime.service';

const context: StageAgentRunContext = {
  runId: 'run-1',
  jobId: 'job-1',
  projectId: 'project-1',
  versionId: 'version-1',
  visitorId: 'visitor-1',
  stage: 'PREMISE',
  workflowState: 'STAGING',
  skillName: 'premise',
  skillVersion: '1.0.0',
  allowedTools: ['submit_stage_draft'],
  lockedStages: [],
  maxSteps: 4,
  tokenBudget: 1_000,
  timeoutMs: 5_000,
};

function submissionRegistry(onSubmit: () => void) {
  const registry = new RunToolRegistry(new Set(['submit_stage_draft']));
  registry.register({
    name: 'submit_stage_draft',
    description: 'submit',
    inputSchema: z.object({ value: z.string() }),
    execute: async () => {
      onSubmit();
      return { accepted: true };
    },
  });
  return registry;
}

describe('StageAgentRuntimeService', () => {
  it('finishes only after a registered submit tool accepts a draft', async () => {
    let submitted = false;
    const registry = submissionRegistry(() => {
      submitted = true;
    });
    const model = {
      executeStep: jest.fn().mockImplementation(async ({ tools }) => {
        await tools.submit_stage_draft.execute({ value: 'draft' });
        return {
          messages: [],
          toolCalls: [{ name: 'submit_stage_draft', input: { value: 'draft' } }],
          usage: { inputTokens: 100, outputTokens: 40 },
        };
      }),
    };
    const runtime = new StageAgentRuntimeService(model as never);

    await expect(
      runtime.run({
        context,
        system: 'test',
        user: 'test',
        registry,
        hasSubmitted: () => submitted,
      }),
    ).resolves.toEqual({
      finishReason: 'submitted',
      steps: 1,
      toolCalls: 1,
      promptTokens: 100,
      completionTokens: 40,
    });
  });

  it('stops when the token budget is exceeded', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      executeStep: jest.fn().mockResolvedValue({
        messages: [],
        toolCalls: [{ name: 'submit_stage_draft', input: { value: 'draft' } }],
        usage: { inputTokens: 300, outputTokens: 20 },
      }),
    };
    const runtime = new StageAgentRuntimeService(model as never);

    await expect(
      runtime.run({
        context: { ...context, tokenBudget: 256 },
        system: 'test',
        user: 'test',
        registry,
        hasSubmitted: () => false,
      }),
    ).rejects.toMatchObject<Partial<StageAgentExecutionError>>({ reason: 'token_limit' });
  });

  it('detects three identical tool calls instead of consuming all steps', async () => {
    const registry = submissionRegistry(() => undefined);
    const model = {
      executeStep: jest.fn().mockResolvedValue({
        messages: [],
        toolCalls: [{ name: 'submit_stage_draft', input: { value: 'same' } }],
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    };
    const runtime = new StageAgentRuntimeService(model as never);

    await expect(
      runtime.run({
        context,
        system: 'test',
        user: 'test',
        registry,
        hasSubmitted: () => false,
      }),
    ).rejects.toMatchObject<Partial<StageAgentExecutionError>>({ reason: 'loop_detected' });
    expect(model.executeStep).toHaveBeenCalledTimes(3);
  });
});

