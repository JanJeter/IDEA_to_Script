import {
  GenerationJobStatus,
  GenerationVersionStatus,
  Prisma,
  ProjectMode,
  ProjectStatus,
  RunStatus,
} from '@prisma/client';
import { GenerationService } from './generation.service';
import { type LlmCallTelemetry, LlmRequestError } from './llm.service';

const timestamp = new Date('2026-08-08T00:00:00.000Z');
const premise = {
  title: '新标题',
  premise: '新的故事前提',
  synopsis: '新的故事梗概',
  theme: '新的主题',
};
const character = {
  name: '林夏',
  role: '主角',
  age: '28',
  description: '独立纪录片导演',
  goal: '完成最后一次拍摄',
  conflict: '必须面对旧友',
  arc: '从逃避到和解',
  voice: '克制而直接',
};
const secondCharacter = {
  ...character,
  name: '周屿',
  role: '对手',
};
const relationship = {
  sourceIndex: 0,
  targetIndex: 1,
  type: '旧友与对手',
  description: '共同经历让他们彼此理解，但对影院命运的选择使两人站到对立面。',
  strength: 4,
  directed: false,
};
const location = {
  name: '旧影院',
  description: '即将拆除的社区影院',
  atmosphere: '安静、潮湿',
  recurringElements: '坏掉的霓虹灯',
};
const beat = {
  act: 1,
  sequence: 1,
  title: '重返影院',
  summary: '林夏回到旧影院。',
  emotionalShift: '疏离到动摇',
};
const scenePlan = {
  sceneNumber: 1,
  beatSequence: 1,
  heading: 'INT. 旧影院 - 夜',
  location: '旧影院',
  timeOfDay: '夜',
  summary: '林夏推开影院大门。',
  estimatedSeconds: 60,
};
const writtenScene = {
  sceneNumber: 1,
  action: '积灰的银幕在风里轻轻晃动。',
  dialogue: [{ character: '林夏', text: '我还是回来了。' }],
};

const project = {
  id: 'project-1',
  visitorId: 'visitor-1',
  activeVersionId: 'active-old',
  mode: ProjectMode.ORIGINAL,
  title: '旧标题',
  logline: '一位导演回到即将拆除的影院。',
  sourceText: null,
  genre: '剧情',
  tone: '克制',
  language: 'zh-CN',
  targetMinutes: 8,
  premise: '旧前提',
  synopsis: '旧梗概',
  theme: '旧主题',
  scriptText: 'Title: 旧标题',
  status: ProjectStatus.READY,
  currentStage: 'COMPLETE',
  regenerationsUsed: 0,
  expiresAt: new Date('2026-08-15T00:00:00.000Z'),
  createdAt: timestamp,
  updatedAt: timestamp,
  characters: [],
  relationships: [],
  locations: [],
  beats: [],
  scenes: [],
};

function workflowVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    projectId: 'project-1',
    jobId: 'job-1',
    status: GenerationVersionStatus.STAGING,
    title: null,
    premise: null,
    synopsis: null,
    theme: null,
    characters: null,
    relationships: null,
    locations: null,
    beats: null,
    scenePlans: null,
    writtenScenes: null,
    scriptText: null,
    currentStage: 'IDEA',
    confirmedStage: null,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    ...overrides,
  };
}

function stagePrisma(version = workflowVersion()) {
  const generationRunCreate = jest.fn().mockResolvedValue({ id: 'run-1' });
  const transaction = {
    generationJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    generationVersion: { update: jest.fn().mockResolvedValue(version) },
    generationRun: {
      create: generationRunCreate,
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    generationProviderCall: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    project: { update: jest.fn().mockResolvedValue(project) },
  };
  return {
    project: {
      findFirst: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockResolvedValue(project),
    },
    generationVersion: {
      findFirst: jest.fn().mockResolvedValue(version),
      update: transaction.generationVersion.update,
    },
    generationRun: {
      create: generationRunCreate,
      update: transaction.generationRun.update,
    },
    $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    transaction,
  };
}

describe('GenerationService staged workflow', () => {
  it('creates a staging version without touching the active screenplay', async () => {
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue(project),
        update: jest.fn().mockResolvedValue(project),
      },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(workflowVersion()),
      },
      scene: { deleteMany: jest.fn() },
    };
    const service = new GenerationService({} as never, {} as never, {} as never);

    const result = await service.prepareDraft(
      transaction as never,
      'project-1',
      'visitor-1',
    );

    expect(result.id).toBe('version-1');
    expect(transaction.generationVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: GenerationVersionStatus.STAGING, currentStage: 'IDEA' }),
    });
    expect(transaction.scene.deleteMany).not.toHaveBeenCalled();
  });

  it('captures active relationships as draft indexes before the first regeneration', async () => {
    const capturedProject = {
      ...project,
      activeVersionId: null,
      characters: [
        { id: 'character-1', projectId: 'project-1', sortOrder: 0, ...character },
        { id: 'character-2', projectId: 'project-1', sortOrder: 1, ...secondCharacter },
      ],
      relationships: [{
        id: 'relationship-1',
        projectId: 'project-1',
        sourceId: 'character-2',
        targetId: 'character-1',
        sortOrder: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...relationship,
      }],
    };
    const create = jest.fn()
      .mockResolvedValueOnce({ id: 'captured-version' })
      .mockResolvedValueOnce(workflowVersion());
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue(capturedProject),
        update: jest.fn().mockResolvedValue(capturedProject),
      },
      generationVersion: { findFirst: jest.fn().mockResolvedValue(null), create },
    };
    const service = new GenerationService({} as never, {} as never, {} as never);

    await service.prepareDraft(transaction as never, 'project-1', 'visitor-1');

    expect(create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        status: GenerationVersionStatus.ACTIVE,
        relationships: [relationship],
      }),
    });
    expect(transaction.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { activeVersionId: 'captured-version' },
    });
  });

  it('generates only the requested stage and leaves it waiting for confirmation', async () => {
    const prisma = stagePrisma();
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);
    const emit = jest.fn().mockResolvedValue(undefined);
    const onCompleted = jest.fn().mockResolvedValue(undefined);

    await service.executeStage(
      'project-1',
      'visitor-1',
      'job-1',
      'version-1',
      'PREMISE',
      emit,
      onCompleted,
      1,
    );

    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.generationVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: expect.objectContaining({ premise: premise.premise, currentStage: 'PREMISE' }),
    });
    expect(prisma.transaction.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { status: ProjectStatus.REVIEWING, currentStage: 'PREMISE' },
    });
    expect(onCompleted).toHaveBeenCalledWith(
      prisma.transaction,
      'version-1',
      'PREMISE',
      expect.objectContaining({ type: 'stage:complete' }),
    );
  });

  it.each(['project write', 'stage:start emit'] as const)(
    'reaches the model exactly once when the first pre-provider %s fails and the stage is retried',
    async (failurePoint) => {
      const prisma = stagePrisma();
      const firstFailure = new Error(`${failurePoint} failed`);
      const emit = jest.fn().mockResolvedValue(undefined);
      if (failurePoint === 'project write') {
        prisma.transaction.project.update.mockRejectedValueOnce(firstFailure);
      } else {
        emit.mockRejectedValueOnce(firstFailure);
      }
      const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
      const service = new GenerationService(prisma as never, llm as never, {} as never);

      await expect(
        service.executeStage(
          'project-1',
          'visitor-1',
          'job-1',
          'version-1',
          'PREMISE',
          emit,
          jest.fn().mockResolvedValue(undefined),
          1,
        ),
      ).rejects.toBe(firstFailure);

      expect(prisma.generationRun.create).not.toHaveBeenCalled();
      expect(llm.generateJson).not.toHaveBeenCalled();

      await service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        emit,
        jest.fn().mockResolvedValue(undefined),
        1,
      );

      expect(prisma.generationRun.create).toHaveBeenCalledTimes(1);
      expect(llm.generateJson).toHaveBeenCalledTimes(1);
      expect(prisma.transaction.generationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: RunStatus.COMPLETED }) }),
      );
    },
  );

  it('lets only the exact current attempt create a Run and call the model across overlapping retries', async () => {
    const prisma = stagePrisma();
    prisma.transaction.generationJob.updateMany.mockImplementation(({ where }) =>
      Promise.resolve({ count: where.attempt === 2 ? 1 : 0 }));
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);
    const emit = jest.fn().mockResolvedValue(undefined);
    const onCompleted = jest.fn().mockResolvedValue(undefined);

    await Promise.all([
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        emit,
        onCompleted,
        1,
      ),
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        emit,
        onCompleted,
        2,
      ),
    ]);

    expect(prisma.transaction.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: GenerationJobStatus.RUNNING, attempt: 1 },
      data: { attempt: 1 },
    });
    expect(prisma.transaction.generationJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: GenerationJobStatus.RUNNING, attempt: 2 },
      data: { attempt: 2 },
    });
    expect(prisma.generationRun.create).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('drops an old paid result after that attempt loses ownership before the completion transaction', async () => {
    const prisma = stagePrisma();
    prisma.transaction.generationJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);
    const onCompleted = jest.fn().mockResolvedValue(undefined);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        onCompleted,
        1,
      ),
    ).resolves.toBeUndefined();

    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.generationVersion.update).not.toHaveBeenCalled();
    expect(prisma.transaction.generationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ providerCallCount: 0 }),
    });
    expect(prisma.transaction.generationRun.update.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(onCompleted).not.toHaveBeenCalled();
    expect(prisma.transaction.project.update).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { status: ProjectStatus.GENERATING, currentStage: 'PREMISE' },
    });
  });

  it('does not roll back a newer owner when an old paid attempt fails', async () => {
    const prisma = stagePrisma();
    prisma.transaction.generationJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const failure = new LlmRequestError('old attempt failed', 'provider_unavailable', false, 503);
    const llm = { model: 'test-model', generateJson: jest.fn().mockRejectedValue(failure) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        jest.fn(),
        1,
      ),
    ).rejects.toBe(failure);

    expect(prisma.transaction.generationRun.updateMany).not.toHaveBeenCalled();
    expect(prisma.transaction.project.update).toHaveBeenCalledTimes(1);
    expect(prisma.transaction.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: { status: ProjectStatus.GENERATING, currentStage: 'PREMISE' },
    });
  });

  it('does not reverse a committed success when the completion acknowledgement is lost', async () => {
    let jobStatus: GenerationJobStatus = GenerationJobStatus.RUNNING;
    const jobAttempt = 1;
    let runStatus: RunStatus = RunStatus.RUNNING;
    let projectState: { status: ProjectStatus; currentStage: string } = {
      status: ProjectStatus.READY,
      currentStage: 'IDEA',
    };
    const runFailureUpdate = jest.fn(
      async ({ where, data }: {
        where: { id: string; status: RunStatus };
        data: { status: RunStatus } & Record<string, unknown>;
      }) => {
        if (where.id !== 'run-1' || where.status !== runStatus) return { count: 0 };
        runStatus = data.status;
        return { count: 1 };
      },
    );
    const transaction = {
      generationJob: {
        updateMany: jest.fn(async ({ where }: {
          where: { id: string; status: GenerationJobStatus; attempt: number };
        }) => ({
          count:
            where.id === 'job-1' &&
            where.status === jobStatus &&
            where.attempt === jobAttempt
              ? 1
              : 0,
        })),
      },
      generationVersion: { update: jest.fn().mockResolvedValue(workflowVersion(premise)) },
      generationRun: {
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        update: jest.fn(async ({ data }: { data: { status: RunStatus } & Record<string, unknown> }) => {
          runStatus = data.status;
          return { id: 'run-1', ...data };
        }),
        updateMany: runFailureUpdate,
      },
      project: {
        update: jest.fn(async ({ data }: {
          data: { status: ProjectStatus; currentStage: string };
        }) => {
          projectState = { ...projectState, ...data };
          return { ...project, ...projectState };
        }),
      },
    };
    const commitAcknowledgementLost = new Error('commit acknowledgement lost');
    let transactionCall = 0;
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(project) },
      generationVersion: { findFirst: jest.fn().mockResolvedValue(workflowVersion()) },
      $transaction: jest.fn().mockImplementation(async (
        callback: (input: typeof transaction) => Promise<unknown>,
      ) => {
        transactionCall += 1;
        const result = await callback(transaction);
        if (transactionCall === 2) throw commitAcknowledgementLost;
        return result;
      }),
    };
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);
    const onCompleted = jest.fn().mockImplementation(async () => {
      jobStatus = GenerationJobStatus.SUCCEEDED;
    });

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        onCompleted,
        1,
      ),
    ).rejects.toMatchObject({ kind: 'result_persistence', retryable: false });

    expect(jobStatus).toBe(GenerationJobStatus.SUCCEEDED);
    expect(runStatus).toBe(RunStatus.COMPLETED);
    expect(projectState).toEqual({ status: ProjectStatus.REVIEWING, currentStage: 'PREMISE' });
    expect(runFailureUpdate).not.toHaveBeenCalled();
    expect(transaction.project.update).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('retries only the result transaction after a serialization abort without calling the model again', async () => {
    const prisma = stagePrisma();
    prisma.$transaction
      .mockImplementationOnce((callback) => callback(prisma.transaction))
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await service.executeStage(
      'project-1',
      'visitor-1',
      'job-1',
      'version-1',
      'PREMISE',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    );

    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(prisma.transaction.generationRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: RunStatus.COMPLETED }) }),
    );
  });

  it('marks a post-provider persistence failure as non-retryable to prevent duplicate cost', async () => {
    const prisma = stagePrisma();
    prisma.$transaction
      .mockImplementationOnce((callback) => callback(prisma.transaction))
      .mockRejectedValueOnce(new Error('database unavailable'));
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(premise) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        1,
      ),
    ).rejects.toMatchObject({ kind: 'result_persistence', retryable: false });

    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('classifies a null HTTP-200 model body as non-retryable invalid output', async () => {
    const prisma = stagePrisma();
    const llm = { model: 'test-model', generateJson: jest.fn().mockResolvedValue(null) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        1,
      ),
    ).rejects.toMatchObject({
      kind: 'invalid_output',
      retryable: false,
      message: '模型返回内容不符合当前阶段的数据契约',
    });

    expect(llm.generateJson).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('persists successful provider-call usage and duration on the run', async () => {
    const prisma = stagePrisma();
    const call: LlmCallTelemetry = {
      sequence: 1,
      structured: true,
      outcome: 'success',
      retryable: false,
      httpStatus: 200,
      promptTokens: 120,
      completionTokens: 35,
      durationMs: 640,
    };
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockImplementation(
        async (
          _prompt: unknown,
          _fallback: unknown,
          options: { onCall: (telemetry: LlmCallTelemetry) => void },
        ) => {
          options.onCall(call);
          return premise;
        },
      ),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await service.executeStage(
      'project-1',
      'visitor-1',
      'job-1',
      'version-1',
      'PREMISE',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    );

    expect(prisma.transaction.generationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: RunStatus.COMPLETED,
        providerCallCount: 1,
        providerDurationMs: 640,
        promptTokens: 120,
        completionTokens: 35,
        providerCalls: {
          create: [
            {
              sequence: 1,
              structured: true,
              outcome: 'success',
              retryable: false,
              httpStatus: 200,
              promptTokens: 120,
              completionTokens: 35,
              durationMs: 640,
            },
          ],
        },
      }),
    });
  });

  it('persists every attempted provider call when stage generation fails', async () => {
    const prisma = stagePrisma();
    const calls: LlmCallTelemetry[] = [
      {
        sequence: 1,
        structured: true,
        outcome: 'unsupported_response_format',
        retryable: false,
        httpStatus: 400,
        promptTokens: null,
        completionTokens: null,
        durationMs: 90,
      },
      {
        sequence: 2,
        structured: false,
        outcome: 'provider_unavailable',
        retryable: false,
        httpStatus: 503,
        promptTokens: null,
        completionTokens: null,
        durationMs: 210,
      },
    ];
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockImplementation(
        async (
          _prompt: unknown,
          _fallback: unknown,
          options: { onCall: (telemetry: LlmCallTelemetry) => void },
        ) => {
          calls.forEach(options.onCall);
          throw new LlmRequestError('provider failed', 'provider_unavailable', false, 503);
        },
      ),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        1,
      ),
    ).rejects.toThrow('provider failed');

    expect(prisma.transaction.generationRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run-1', status: RunStatus.RUNNING },
      data: expect.objectContaining({
        status: RunStatus.FAILED,
        providerCallCount: 2,
        providerDurationMs: 300,
        promptTokens: null,
        completionTokens: null,
      }),
    });
    const failedRunData = prisma.transaction.generationRun.updateMany.mock.calls[0][0].data;
    expect(failedRunData).not.toHaveProperty('providerCalls');
    expect(prisma.transaction.generationProviderCall.createMany).toHaveBeenCalledWith({
      data: calls.map((call) => ({ runId: 'run-1', ...call })),
      skipDuplicates: true,
    });
  });

  it('logs cleanup persistence failures while preserving the original provider error', async () => {
    const prisma = stagePrisma();
    const cleanupFailure = new Error('cleanup transaction failed');
    prisma.transaction.generationRun.updateMany.mockRejectedValue(cleanupFailure);
    const providerFailure = new LlmRequestError(
      'provider transport failed',
      'provider_unavailable',
      false,
      503,
    );
    const llm = { model: 'test-model', generateJson: jest.fn().mockRejectedValue(providerFailure) };
    const service = new GenerationService(prisma as never, llm as never, {} as never);
    const cleanupLog = jest.fn();
    (service as unknown as { logger: { error: typeof cleanupLog } }).logger.error = cleanupLog;

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-1',
        'version-1',
        'PREMISE',
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        1,
      ),
    ).rejects.toBe(providerFailure);

    expect(cleanupLog).toHaveBeenCalledWith(
      'Generation cleanup failed for job job-1',
      expect.stringContaining(cleanupFailure.message),
    );
  });

  it('uses the gated PREMISE Agent without calling the legacy JSON generator', async () => {
    const prisma = stagePrisma();
    const llm = { model: 'test-model', generateJson: jest.fn() };
    const premiseAgent = {
      enabled: true,
      generate: jest.fn().mockResolvedValue({
        draft: premise,
        telemetry: {
          finishReason: 'submitted',
          steps: 2,
          toolCalls: 2,
          promptTokens: 140,
          completionTokens: 80,
        },
      }),
    };
    const service = new GenerationService(
      prisma as never,
      llm as never,
      {} as never,
      premiseAgent as never,
    );

    await service.executeStage(
      'project-1',
      'visitor-1',
      'job-1',
      'version-1',
      'PREMISE',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    );

    expect(llm.generateJson).not.toHaveBeenCalled();
    expect(premiseAgent.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        jobId: 'job-1',
        project,
        versionId: 'version-1',
      }),
    );
    expect(prisma.transaction.generationRun.update).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: expect.objectContaining({ promptTokens: 140, completionTokens: 80 }),
    });
  });

  it('keeps confirmed stage content when the next stage fails', async () => {
    const version = workflowVersion({
      ...premise,
      currentStage: 'PREMISE',
      confirmedStage: 'PREMISE',
    });
    const prisma = stagePrisma(version);
    const llm = {
      model: 'test-model',
      generateJson: jest
        .fn()
        .mockRejectedValue(new LlmRequestError('failed', 'provider_unavailable', false, 503)),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-2',
        'version-1',
        'CHARACTERS',
        jest.fn().mockResolvedValue(undefined),
        jest.fn(),
        1,
      ),
    ).rejects.toThrow('failed');

    expect(prisma.transaction.generationVersion.update).not.toHaveBeenCalled();
    expect(prisma.transaction.project.update).toHaveBeenLastCalledWith({
      where: { id: 'project-1' },
      data: { status: ProjectStatus.REVIEWING, currentStage: 'PREMISE' },
    });
  });

  it('sanitizes generated character relationships before saving the draft', async () => {
    const version = workflowVersion({
      ...premise,
      currentStage: 'PREMISE',
      confirmedStage: 'PREMISE',
    });
    const prisma = stagePrisma(version);
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockResolvedValue({
        characters: [character, secondCharacter],
        relationships: [
          { ...relationship, sourceIndex: 1, targetIndex: 0, strength: 99 },
          relationship,
          {
            ...relationship,
            type: '未解旧债',
            description: '周屿仍在追问林夏当年离开的真正原因。',
            directed: true,
          },
          { ...relationship, sourceIndex: 0, targetIndex: 0 },
          { ...relationship, sourceIndex: 0.5 },
          { ...relationship, type: '   ' },
        ],
      }),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await service.executeStage(
      'project-1',
      'visitor-1',
      'job-2',
      'version-1',
      'CHARACTERS',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    );

    expect(prisma.transaction.generationVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: expect.objectContaining({
        characters: [character, secondCharacter],
        relationships: [
          { ...relationship, strength: 5 },
          {
            ...relationship,
            type: '未解旧债',
            description: '周屿仍在追问林夏当年离开的真正原因。',
            directed: true,
          },
        ],
        currentStage: 'CHARACTERS',
      }),
    });
  });

  it('rejects a generated character stage without scheduling another paid attempt', async () => {
    const version = workflowVersion({
      ...premise,
      currentStage: 'PREMISE',
      confirmedStage: 'PREMISE',
    });
    const prisma = stagePrisma(version);
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockResolvedValue({
        characters: [character, secondCharacter],
      }),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(
      service.executeStage(
        'project-1',
        'visitor-1',
        'job-2',
        'version-1',
        'CHARACTERS',
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue(undefined),
        1,
      ),
    ).rejects.toMatchObject({
      kind: 'invalid_output',
      retryable: false,
      message: '人物关系必须包含 2–6 条有效关系',
    });

    expect(prisma.transaction.generationVersion.update).not.toHaveBeenCalled();
  });

  it('rejects a generated character stage when every relationship is invalid', async () => {
    const version = workflowVersion({
      ...premise,
      currentStage: 'PREMISE',
      confirmedStage: 'PREMISE',
    });
    const prisma = stagePrisma(version);
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockResolvedValue({
        characters: [character, secondCharacter],
        relationships: [
          { ...relationship, sourceIndex: 0, targetIndex: 0 },
          { ...relationship, sourceIndex: 0, targetIndex: 4 },
          { ...relationship, type: '   ' },
        ],
      }),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(service.executeStage(
      'project-1',
      'visitor-1',
      'job-2',
      'version-1',
      'CHARACTERS',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    )).rejects.toThrow('人物关系必须包含 2–6 条有效关系');

    expect(prisma.transaction.generationVersion.update).not.toHaveBeenCalled();
  });

  it('rejects malformed generated characters before they enter the draft', async () => {
    const version = workflowVersion({
      ...premise,
      currentStage: 'PREMISE',
      confirmedStage: 'PREMISE',
    });
    const prisma = stagePrisma(version);
    const llm = {
      model: 'test-model',
      generateJson: jest.fn().mockResolvedValue({
        characters: [{ ...character, role: null }],
        relationships: [],
      }),
    };
    const service = new GenerationService(prisma as never, llm as never, {} as never);

    await expect(service.executeStage(
      'project-1',
      'visitor-1',
      'job-2',
      'version-1',
      'CHARACTERS',
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
      1,
    )).rejects.toThrow('characters[0].role');
  });

  it('sanitizes relationship edits when saving the character stage', async () => {
    const version = workflowVersion({
      ...premise,
      characters: [character, secondCharacter],
      relationships: [relationship],
      currentStage: 'CHARACTERS',
      confirmedStage: 'PREMISE',
    });
    const update = jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }));
    const prisma = {
      generationVersion: { findFirst: jest.fn().mockResolvedValue(version), update },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GenerationService(prisma as never, {} as never, {} as never);

    const result = await service.updateStage('project-1', 'visitor-1', 'characters', {
      characters: [character, secondCharacter],
      relationships: [
        { ...relationship, strength: -4 },
        { ...relationship, strength: 3 },
        { ...relationship, targetIndex: 2 },
        { ...relationship, description: '' },
      ],
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        characters: [character, secondCharacter],
        relationships: [{ ...relationship, strength: 1 }],
      },
    });
    expect(result.draft?.relationships).toEqual([{ ...relationship, strength: 1 }]);
  });

  it('preserves existing relationships when an older client only saves characters', async () => {
    const version = workflowVersion({
      ...premise,
      characters: [character, secondCharacter],
      relationships: [relationship],
      currentStage: 'CHARACTERS',
      confirmedStage: 'PREMISE',
    });
    const update = jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }));
    const prisma = {
      generationVersion: { findFirst: jest.fn().mockResolvedValue(version), update },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GenerationService(prisma as never, {} as never, {} as never);

    await service.updateStage('project-1', 'visitor-1', 'characters', {
      characters: [character, secondCharacter],
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        characters: [character, secondCharacter],
        relationships: [relationship],
      },
    });
  });

  it('rejects an older client that changes character identity without relationship indexes', async () => {
    const version = workflowVersion({
      ...premise,
      characters: [character, secondCharacter],
      relationships: [relationship],
      currentStage: 'CHARACTERS',
      confirmedStage: 'PREMISE',
    });
    const update = jest.fn();
    const prisma = {
      generationVersion: { findFirst: jest.fn().mockResolvedValue(version), update },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GenerationService(prisma as never, {} as never, {} as never);

    await expect(service.updateStage('project-1', 'visitor-1', 'characters', {
      characters: [secondCharacter, character],
    })).rejects.toThrow('必须同时提交 relationships');
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects an older client that omits relationships for duplicate character names', async () => {
    const duplicateNameCharacter = {
      ...secondCharacter,
      name: character.name,
      description: '与林夏同名的影院投资人',
    };
    const version = workflowVersion({
      ...premise,
      characters: [character, duplicateNameCharacter],
      relationships: [relationship],
      currentStage: 'CHARACTERS',
      confirmedStage: 'PREMISE',
    });
    const update = jest.fn();
    const prisma = {
      generationVersion: { findFirst: jest.fn().mockResolvedValue(version), update },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GenerationService(prisma as never, {} as never, {} as never);

    await expect(service.updateStage('project-1', 'visitor-1', 'characters', {
      characters: [duplicateNameCharacter, character],
    })).rejects.toThrow('必须同时提交 relationships');

    expect(update).not.toHaveBeenCalled();
  });

  it('allows an older client to omit relationships for duplicate names when no edges exist', async () => {
    const duplicateNameCharacter = {
      ...secondCharacter,
      name: character.name,
      description: '与林夏同名的影院投资人',
    };
    const version = workflowVersion({
      ...premise,
      characters: [character, duplicateNameCharacter],
      relationships: [],
      currentStage: 'CHARACTERS',
      confirmedStage: 'PREMISE',
    });
    const update = jest.fn().mockImplementation(({ data }) => ({ ...version, ...data }));
    const prisma = {
      generationVersion: { findFirst: jest.fn().mockResolvedValue(version), update },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new GenerationService(prisma as never, {} as never, {} as never);

    await service.updateStage('project-1', 'visitor-1', 'characters', {
      characters: [duplicateNameCharacter, character],
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: {
        characters: [duplicateNameCharacter, character],
        relationships: [],
      },
    });
  });

  it('activates the completed draft only after the script is confirmed', async () => {
    const version = workflowVersion({
      ...premise,
      characters: [character, secondCharacter],
      relationships: [relationship],
      locations: [location],
      beats: [beat],
      scenePlans: [scenePlan],
      writtenScenes: [writtenScene],
      scriptText: 'Title: 新标题',
      currentStage: 'SCRIPT',
      confirmedStage: 'SCENES',
    });
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue(project),
        update: jest.fn().mockResolvedValue(project),
      },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue(version),
        update: jest.fn().mockResolvedValue(version),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      scene: { deleteMany: jest.fn(), createMany: jest.fn() },
      beat: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([{ id: 'beat-new', sequence: 1 }]),
      },
      character: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { id: 'character-1', sortOrder: 0 },
          { id: 'character-2', sortOrder: 1 },
        ]),
      },
      characterRelationship: { deleteMany: jest.fn(), createMany: jest.fn() },
      location: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const service = new GenerationService({} as never, {} as never, {} as never);

    await service.activateDraft(transaction as never, 'project-1', 'visitor-1', 'version-1');

    expect(transaction.scene.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'project-1' } });
    expect(transaction.characterRelationship.createMany).toHaveBeenCalledWith({
      data: [{
        projectId: 'project-1',
        sourceId: 'character-1',
        targetId: 'character-2',
        type: relationship.type,
        description: relationship.description,
        strength: 4,
        directed: false,
        sortOrder: 0,
      }],
    });
    expect(transaction.generationVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: expect.objectContaining({
        status: GenerationVersionStatus.ACTIVE,
        confirmedStage: 'SCRIPT',
      }),
    });
    expect(transaction.project.update).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      data: expect.objectContaining({
        activeVersionId: 'version-1',
        status: ProjectStatus.READY,
        currentStage: 'COMPLETE',
      }),
    });
  });
});
