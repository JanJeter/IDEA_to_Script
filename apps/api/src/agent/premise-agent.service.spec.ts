import { ConfigService } from '@nestjs/config';
import { ProjectMode, ProjectStatus } from '@prisma/client';
import { PremiseAgentService } from './premise-agent.service';

const timestamp = new Date('2026-08-08T00:00:00.000Z');
const project = {
  id: 'project-1',
  visitorId: 'visitor-1',
  activeVersionId: null,
  trendTopicId: null,
  mode: ProjectMode.ORIGINAL,
  title: '旧影院',
  logline: '一位导演回到即将拆除的影院。',
  sourceText: null,
  genre: '剧情',
  tone: '克制',
  language: 'zh-CN',
  targetMinutes: 8,
  premise: null,
  synopsis: null,
  theme: null,
  scriptText: null,
  status: ProjectStatus.DRAFT,
  currentStage: 'IDEA',
  regenerationsUsed: 0,
  expiresAt: new Date('2026-08-15T00:00:00.000Z'),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const draft = {
  title: '最后一场放映',
  premise: '一位逃避往事的导演必须在影院拆除前完成最后一场放映。',
  synopsis: '导演重返旧影院，在放映过程中被迫面对当年的背叛。',
  theme: '记忆只有被共同看见，才可能获得新的解释。',
};

const enabledConfig = () =>
  new ConfigService({
    GENERATION_RUNTIME: 'agent',
    AGENT_ENABLED_STAGES: 'PREMISE',
    DEMO_MODE: 'false',
    LLM_API_KEY: 'test',
  });

const submittedResult = () => ({
  draft,
  telemetry: {
    finishReason: 'submitted' as const,
    steps: 1,
    toolCalls: 1,
    providerCalls: 1,
    retries: 0,
    promptTokens: 120,
    completionTokens: 60,
    cachedInputTokens: 0,
    providerDurationMs: 20,
  },
});

describe('PremiseAgentService', () => {
  it('is disabled by default so existing generation behavior does not change', () => {
    const service = new PremiseAgentService(
      new ConfigService({ DEMO_MODE: 'false', LLM_API_KEY: 'test' }),
      { available: true } as never,
    );
    expect(service.enabled).toBe(false);
  });

  it('maps the owned Prisma project to scoped Agent memory and capabilities', async () => {
    const agent = {
      available: true,
      generate: jest.fn().mockImplementation(async (input) => {
        const memory = await input.memory.load({
          projectId: input.projectId,
          versionId: input.versionId,
          stage: 'PREMISE',
        });
        expect(memory.seed.logline).toBe(project.logline);
        expect(input.capabilities).toEqual(
          expect.objectContaining({
            projectId: project.id,
            versionId: 'version-1',
            stage: 'PREMISE',
            writableStages: ['PREMISE'],
          }),
        );
        expect(input.budget).toEqual(
          expect.objectContaining({
            maxContextTokens: 16_000,
            maxCumulativeTokens: 16_000,
            maxProviderAttemptsPerStep: 2,
          }),
        );
        return submittedResult();
      }),
    };
    const service = new PremiseAgentService(enabledConfig(), agent as never);

    await expect(
      service.generate({
        project,
        runId: 'run-1',
        jobId: 'job-1',
        versionId: 'version-1',
        visitorId: 'visitor-1',
      }),
    ).resolves.toEqual({
      draft,
      telemetry: expect.objectContaining({ finishReason: 'submitted' }),
    });
  });

  it('rejects a visitor capability that does not own the project', async () => {
    const agent = { available: true, generate: jest.fn() };
    const service = new PremiseAgentService(enabledConfig(), agent as never);

    await expect(
      service.generate({
        project,
        runId: 'run-1',
        jobId: 'job-1',
        versionId: 'version-1',
        visitorId: 'visitor-2',
      }),
    ).rejects.toThrow('Agent visitor capability does not match the project owner');
    expect(agent.generate).not.toHaveBeenCalled();
  });

  it('keeps adaptation source text in the database-backed project snapshot', async () => {
    const sourceText = '一段用于改编的原始小说。'.repeat(500);
    const agent = {
      available: true,
      generate: jest.fn().mockImplementation(async (input) => {
        const memory = await input.memory.load({
          projectId: input.projectId,
          versionId: input.versionId,
          stage: 'PREMISE',
        });
        expect(memory.seed.mode).toBe('ADAPTATION');
        expect(memory.seed.sourceText).toBe(sourceText);
        return submittedResult();
      }),
    };
    const service = new PremiseAgentService(enabledConfig(), agent as never);

    await service.generate({
      project: { ...project, mode: ProjectMode.ADAPTATION, sourceText },
      runId: 'run-adaptation',
      jobId: 'job-adaptation',
      versionId: 'version-adaptation',
      visitorId: 'visitor-1',
    });
  });
});
