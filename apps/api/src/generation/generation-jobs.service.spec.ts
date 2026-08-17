import { ConfigService } from '@nestjs/config';
import {
  type GenerationJob,
  GenerationJobStatus,
  GenerationVersionStatus,
  Prisma,
} from '@prisma/client';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NonRetryableGenerationError } from './generation-error';
import { GenerationJobsService } from './generation-jobs.service';
import { LlmRequestError } from './llm.service';

const timestamp = new Date('2026-08-08T00:00:00.000Z');
const config = new ConfigService({ PROJECT_REGENERATIONS_MAX: '3' });

function generationJob(status: GenerationJobStatus = GenerationJobStatus.QUEUED) {
  return {
    id: 'job-1',
    projectId: 'project-1',
    versionId: 'version-1',
    stage: 'PREMISE',
    status,
    progress: 1,
    currentStage: 'PREMISE',
    message: '故事内核已进入生成队列',
    safeErrorMessage: null,
    attempt: 0,
    eventSequence: 1,
    resultVersionId: null,
    queuedAt: timestamp,
    startedAt: null,
    completedAt: null,
    updatedAt: timestamp,
  };
}

function terminalFailedJob(message = '模型服务连接失败') {
  return {
    ...generationJob(GenerationJobStatus.FAILED),
    status: GenerationJobStatus.FAILED,
    progress: 0,
    message,
    safeErrorMessage: message,
    attempt: 1,
    eventSequence: 3,
    startedAt: timestamp,
    completedAt: new Date(timestamp.getTime() + 60_000),
  };
}

type TestGenerationJob = GenerationJob;

function applyJobUpdate(
  current: TestGenerationJob,
  data: Record<string, unknown>,
): TestGenerationJob {
  const sequenceUpdate = data.eventSequence;
  const increment =
    typeof sequenceUpdate === 'object' &&
    sequenceUpdate !== null &&
    'increment' in sequenceUpdate &&
    typeof sequenceUpdate.increment === 'number'
      ? sequenceUpdate.increment
      : 0;
  const next = { ...data };
  delete next.eventSequence;
  return {
    ...current,
    ...next,
    eventSequence:
      typeof sequenceUpdate === 'number' ? sequenceUpdate : current.eventSequence + increment,
  } as TestGenerationJob;
}

function alwaysClaimedJobStore(initial: TestGenerationJob) {
  let current = { ...initial };
  const updateMany = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      current = applyJobUpdate(current, data);
      return { count: 1 };
    },
  );
  const findUnique = jest.fn(async () => ({ ...current }));
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      current = applyJobUpdate(current, data);
      return { ...current };
    },
  );
  return {
    model: { updateMany, findUnique, update },
    updateMany,
    update,
    findUnique,
    read: () => ({ ...current }),
  };
}

function matchesJobWhere(current: TestGenerationJob, where: Record<string, unknown>): boolean {
  if (typeof where.id === 'string' && current.id !== where.id) return false;
  if (typeof where.attempt === 'number' && current.attempt !== where.attempt) return false;
  if (typeof where.attempt === 'object' && where.attempt !== null && 'lte' in where.attempt) {
    const maximum = where.attempt.lte;
    if (typeof maximum !== 'number' || current.attempt > maximum) return false;
  }

  if (typeof where.status === 'string' && current.status !== where.status) return false;
  if (typeof where.status === 'object' && where.status !== null && 'in' in where.status) {
    const allowed = where.status.in;
    if (!Array.isArray(allowed) || !allowed.includes(current.status)) return false;
  }

  if (Array.isArray(where.OR)) {
    const matchesBranch = where.OR.some(
      (branch) =>
        typeof branch === 'object' &&
        branch !== null &&
        matchesJobWhere(current, branch as Record<string, unknown>),
    );
    if (!matchesBranch) return false;
  }
  return true;
}

function casJobStore(initial: TestGenerationJob) {
  let current = { ...initial };
  const updateMany = jest.fn(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!matchesJobWhere(current, where)) return { count: 0 };
      current = applyJobUpdate(current, data);
      return { count: 1 };
    },
  );
  const findUnique = jest.fn(async () => ({ ...current }));
  const update = jest.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      current = applyJobUpdate(current, data);
      return { ...current };
    },
  );
  return {
    model: { updateMany, findUnique, update },
    updateMany,
    update,
    findUnique,
    force: (data: Record<string, unknown>) => {
      current = applyJobUpdate(current, data);
    },
    read: () => ({ ...current }),
  };
}

function failedStageRepairModels(currentStage = 'IDEA') {
  return {
    generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    generationVersion: {
      findFirst: jest.fn().mockResolvedValue({ currentStage, confirmedStage: null }),
    },
    project: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function serviceWith(
  prisma: object,
  queue: object = {},
  generation: object = {},
  abuseProtection: object = {},
) {
  const protection = {
    runSerializableTransaction: jest.fn((operation: (transaction: unknown) => unknown) =>
      (prisma as { $transaction: (input: (transaction: unknown) => unknown) => unknown })
        .$transaction(operation)),
    ...abuseProtection,
  };
  return new GenerationJobsService(
    prisma as never,
    queue as never,
    generation as never,
    protection as never,
    config,
  );
}

describe('GenerationJobsService', () => {
  it('maps a last-resort enqueue P2034 to HTTP 503 instead of leaking a 500', async () => {
    const queue = { ready: jest.fn().mockResolvedValue(undefined) };
    const abuseProtection = {
      consumeGenerationTicket: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      ),
    };
    const service = serviceWith({}, queue, {}, abuseProtection);

    await expect(service.enqueue('project-1', 'visitor-1', 'ticket')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('maps a pg-boss raw SQLSTATE 40001 to HTTP 503 instead of leaking P2010', async () => {
    const queue = { ready: jest.fn().mockResolvedValue(undefined) };
    const abuseProtection = {
      consumeGenerationTicket: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Raw query failed', {
          code: 'P2010',
          clientVersion: 'test',
          meta: { code: '40001' },
        }),
      ),
    };
    const service = serviceWith({}, queue, {}, abuseProtection);

    await expect(service.enqueue('project-1', 'visitor-1', 'ticket')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('creates the first stage draft and pg-boss job in the quota transaction', async () => {
    const transaction = {
      project: {
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(generationJob()),
      },
      generationVersion: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const queue = {
      ready: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue('job-1'),
    };
    const generation = {
      prepareDraft: jest.fn().mockResolvedValue({ id: 'version-1' }),
    };
    const abuseProtection = {
      consumeGenerationTicket: jest
        .fn()
        .mockImplementation((_ticket, _projectId, _visitorId, operation) => operation(transaction)),
    };
    const service = serviceWith({}, queue, generation, abuseProtection);

    const result = await service.enqueue('project-1', 'visitor-1', 'ticket');

    expect(generation.prepareDraft).toHaveBeenCalledWith(
      transaction,
      'project-1',
      'visitor-1',
    );
    expect(transaction.generationVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { jobId: expect.any(String) },
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      transaction,
      expect.any(String),
      expect.objectContaining({
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      }),
    );
    expect(result).toEqual(expect.objectContaining({ stage: 'PREMISE', status: 'QUEUED' }));
  });

  it('rechecks the current trend risk before every queued generation stage', async () => {
    const transaction = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          mode: 'TREND_INSPIRED',
          trendTopic: { riskLevel: 'REVIEW' },
        }),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      generationVersion: { update: jest.fn() },
    };
    const queue = { ready: jest.fn(), enqueue: jest.fn() };
    const generation = { prepareDraft: jest.fn().mockResolvedValue({ id: 'version-1' }) };
    const abuseProtection = {
      consumeGenerationTicket: jest
        .fn()
        .mockImplementation((_ticket, _projectId, _visitorId, operation) => operation(transaction)),
    };
    const service = serviceWith({}, queue, generation, abuseProtection);

    await expect(service.enqueue('project-1', 'visitor-1', 'ticket'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('confirms one stage and queues the next without consuming another ticket', async () => {
    const created = { ...generationJob(), id: 'job-2', stage: 'CHARACTERS' };
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValueOnce(null),
        create: jest.fn().mockResolvedValue(created),
      },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: GenerationVersionStatus.STAGING,
          currentStage: 'PREMISE',
          confirmedStage: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const queue = { ready: jest.fn(), enqueue: jest.fn().mockResolvedValue('job-2') };
    const runSerializableTransaction = jest.fn((operation) => prisma.$transaction(operation));
    const service = serviceWith(
      prisma,
      queue,
      { parseStage: (stage: string) => stage },
      { runSerializableTransaction },
    );

    const result = await service.confirmStage('project-1', 'visitor-1', 'PREMISE');

    expect(transaction.generationVersion.update).toHaveBeenCalledWith({
      where: { id: 'version-1' },
      data: { confirmedStage: 'PREMISE' },
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      transaction,
      expect.any(String),
      expect.objectContaining({ stage: 'CHARACTERS', versionId: 'version-1' }),
    );
    expect(result).toEqual(
      expect.objectContaining({ completed: false, job: expect.objectContaining({ stage: 'CHARACTERS' }) }),
    );
    expect(runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      '确认阶段并进入下一阶段时发生冲突，请稍后重试',
    );
  });

  it('runs stage regeneration through the shared serializable retry gate', async () => {
    const created = { ...generationJob(), id: 'job-regenerated', stage: 'PREMISE' };
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
        update: jest.fn().mockResolvedValue({}),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: GenerationVersionStatus.STAGING,
          currentStage: 'IDEA',
          confirmedStage: null,
        }),
      },
    };
    const prisma = { $transaction: jest.fn().mockImplementation((callback) => callback(transaction)) };
    const queue = { ready: jest.fn(), enqueue: jest.fn().mockResolvedValue('job-regenerated') };
    const runSerializableTransaction = jest.fn((operation) => prisma.$transaction(operation));
    const service = serviceWith(
      prisma,
      queue,
      { parseStage: (stage: string) => stage },
      { runSerializableTransaction },
    );

    const result = await service.regenerateStage('project-1', 'visitor-1', 'PREMISE');

    expect(result).toEqual(expect.objectContaining({ id: 'job-regenerated', stage: 'PREMISE' }));
    expect(runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      '重新生成任务入队冲突，请稍后重试',
    );
    expect(queue.enqueue).toHaveBeenCalledWith(
      transaction,
      expect.any(String),
      expect.objectContaining({ projectId: 'project-1', stage: 'PREMISE' }),
    );
  });

  it('activates the version when the script stage is confirmed', async () => {
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
      },
      generationJob: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'script-job' }),
        update: jest.fn().mockResolvedValue({}),
      },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: GenerationVersionStatus.STAGING,
          currentStage: 'SCRIPT',
          confirmedStage: 'SCENES',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const generation = {
      parseStage: (stage: string) => stage,
      activateDraft: jest.fn().mockResolvedValue(undefined),
    };
    const service = serviceWith(prisma, { ready: jest.fn() }, generation);

    const result = await service.confirmStage('project-1', 'visitor-1', 'SCRIPT');

    expect(generation.activateDraft).toHaveBeenCalledWith(
      transaction,
      'project-1',
      'visitor-1',
      'version-1',
    );
    expect(transaction.generationJob.update).toHaveBeenCalledWith({
      where: { id: 'script-job' },
      data: { resultVersionId: 'version-1' },
    });
    expect(result).toEqual({ job: null, completed: true });
  });

  it('does not activate a completed trend draft after its risk changes', async () => {
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
        findUnique: jest.fn().mockResolvedValue({
          mode: 'TREND_INSPIRED',
          trendTopic: { riskLevel: 'REVIEW' },
        }),
      },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'version-1',
          status: GenerationVersionStatus.STAGING,
          currentStage: 'SCRIPT',
          confirmedStage: 'SCENES',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const generation = {
      parseStage: (stage: string) => stage,
      activateDraft: jest.fn(),
    };
    const service = serviceWith(prisma, { ready: jest.fn() }, generation);

    await expect(service.confirmStage('project-1', 'visitor-1', 'SCRIPT'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(generation.activateDraft).not.toHaveBeenCalled();
  });

  it('does not reveal a job outside a live visitor project', async () => {
    const prisma = { generationJob: { findFirst: jest.fn().mockResolvedValue(null) } };
    const service = serviceWith(prisma);

    await expect(service.get('job-1', 'visitor-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.generationJob.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        project: {
          visitorId: 'visitor-2',
          expiresAt: { gt: expect.any(Date) },
        },
      },
    });
  });

  it('repairs a terminal FAILED Run and Project during get without adding another job event', async () => {
    const failed = terminalFailedJob();
    const repairModels = failedStageRepairModels('PREMISE');
    const createEvent = jest.fn();
    const terminalCas = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      ...repairModels,
      generationJob: {
        updateMany: terminalCas,
        findUnique: jest.fn().mockResolvedValue(failed),
      },
      generationJobEvent: { create: createEvent },
    };
    const prisma = {
      generationJob: { findFirst: jest.fn().mockResolvedValue(failed) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma);

    await expect(service.get('job-1', 'visitor-1')).resolves.toEqual(
      expect.objectContaining({ status: GenerationJobStatus.FAILED, error: failed.safeErrorMessage }),
    );

    expect(terminalCas).toHaveBeenCalledWith({
      where: {
        id: failed.id,
        status: GenerationJobStatus.FAILED,
        attempt: failed.attempt,
        eventSequence: failed.eventSequence,
      },
      data: { status: GenerationJobStatus.FAILED },
    });
    expect(repairModels.generationRun.updateMany).toHaveBeenCalledWith({
      where: {
        versionId: failed.versionId,
        stage: failed.stage,
        startedAt: { gte: failed.queuedAt, lte: failed.completedAt },
        status: 'RUNNING',
      },
      data: {
        status: 'FAILED',
        completedAt: failed.completedAt,
        error: failed.safeErrorMessage,
      },
    });
    expect(repairModels.project.updateMany).toHaveBeenCalledWith({
      where: {
        id: failed.projectId,
        status: 'GENERATING',
        jobs: { none: { status: { in: expect.arrayContaining([
          GenerationJobStatus.QUEUED,
          GenerationJobStatus.RUNNING,
          GenerationJobStatus.RETRYING,
        ]) } } },
      },
      data: { status: 'REVIEWING', currentStage: 'PREMISE' },
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it('does not repair Run or Project when terminal FAILED ownership CAS loses to SUCCEEDED', async () => {
    const failed = terminalFailedJob();
    const succeeded = {
      ...failed,
      status: GenerationJobStatus.SUCCEEDED,
      safeErrorMessage: null,
      message: '故事内核完成',
    };
    const repairModels = failedStageRepairModels();
    const transaction = {
      ...repairModels,
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(succeeded),
      },
    };
    const prisma = {
      generationJob: { findFirst: jest.fn().mockResolvedValue(failed) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma);

    await expect(service.get('job-1', 'visitor-1')).resolves.toEqual(
      expect.objectContaining({ status: GenerationJobStatus.SUCCEEDED, error: null }),
    );
    expect(repairModels.generationRun.updateMany).not.toHaveBeenCalled();
    expect(repairModels.generationVersion.findFirst).not.toHaveBeenCalled();
    expect(repairModels.project.updateMany).not.toHaveBeenCalled();
  });

  it('repairs the latest FAILED job when getActiveForProject finds no active job', async () => {
    const failed = terminalFailedJob();
    const repairModels = failedStageRepairModels('PREMISE');
    const transaction = {
      ...repairModels,
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(failed),
      },
    };
    const findJob = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
      generationJob: { findFirst: findJob },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma);

    await expect(service.getActiveForProject('project-1', 'visitor-1')).resolves.toEqual({ job: null });

    expect(findJob).toHaveBeenNthCalledWith(1, {
      where: { projectId: 'project-1', status: { in: expect.any(Array) } },
      orderBy: { queuedAt: 'desc' },
    });
    expect(findJob).toHaveBeenNthCalledWith(2, {
      where: { projectId: 'project-1', status: GenerationJobStatus.FAILED },
      orderBy: { completedAt: 'desc' },
    });
    expect(repairModels.generationRun.updateMany).toHaveBeenCalledTimes(1);
    expect(repairModels.project.updateMany).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer active job Project in GENERATING while repairing an older FAILED Run', async () => {
    const failed = terminalFailedJob();
    let project = { status: 'GENERATING', currentStage: 'CHARACTERS' };
    const projectUpdate = jest.fn(async ({ where, data }) => {
      const activeGuard = where.jobs?.none?.status?.in;
      if (Array.isArray(activeGuard) && activeGuard.includes(GenerationJobStatus.RUNNING)) {
        return { count: 0 };
      }
      project = { ...project, ...data };
      return { count: 1 };
    });
    const transaction = {
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(failed),
      },
      generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      generationVersion: {
        findFirst: jest.fn().mockResolvedValue({ currentStage: 'PREMISE', confirmedStage: null }),
      },
      project: { updateMany: projectUpdate },
    };
    const prisma = {
      generationJob: { findFirst: jest.fn().mockResolvedValue(failed) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma);

    await service.get('job-1', 'visitor-1');

    expect(projectUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'project-1',
        status: 'GENERATING',
        jobs: { none: { status: { in: expect.any(Array) } } },
      }),
    }));
    expect(project).toEqual({ status: 'GENERATING', currentStage: 'CHARACTERS' });
  });

  it.each(['completed', 'failed', 'cancelled'] as const)(
    'does not let a stale RUNNING get() snapshot overwrite a concurrently terminal job when pg-boss is %s',
    async (queueState) => {
      const stale = generationJob(GenerationJobStatus.RUNNING);
      const terminal = {
        ...stale,
        status: queueState === 'completed' ? GenerationJobStatus.SUCCEEDED : GenerationJobStatus.FAILED,
        completedAt: timestamp,
      };
      const transaction = {
        generationJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          findUnique: jest.fn().mockResolvedValue(terminal),
        },
        generationJobEvent: { create: jest.fn() },
      };
      const prisma = {
        generationJob: { findFirst: jest.fn().mockResolvedValue(stale) },
        generationRun: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
      };
      const queue = { findJob: jest.fn().mockResolvedValue({ state: queueState }) };
      const service = serviceWith(prisma, queue);

      const result = await service.get('job-1', 'visitor-1');

      expect(result.status).toBe(terminal.status);
      expect(transaction.generationJob.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'job-1',
            status: stale.status,
            attempt: stale.attempt,
            eventSequence: stale.eventSequence,
          },
        }),
      );
      expect(transaction.generationJobEvent.create).not.toHaveBeenCalled();
    },
  );

  it('persists exactly one terminal reconciliation event after the active-state CAS succeeds', async () => {
    const stale = generationJob(GenerationJobStatus.RUNNING);
    const reconciled = {
      ...stale,
      status: GenerationJobStatus.FAILED,
      eventSequence: stale.eventSequence + 1,
      completedAt: timestamp,
    };
    const transaction = {
      ...failedStageRepairModels(),
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(reconciled),
      },
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      generationJob: { findFirst: jest.fn().mockResolvedValue(stale) },
      generationRun: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma, { findJob: jest.fn().mockResolvedValue({ state: 'completed' }) });

    const result = await service.get('job-1', 'visitor-1');

    expect(result.status).toBe(GenerationJobStatus.FAILED);
    expect(transaction.generationJobEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.generationJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: 'job-1',
        sequence: reconciled.eventSequence,
        type: 'error',
      }),
    });
  });

  it('does not let a stale RUNNING active-job snapshot move a concurrent terminal job back to RETRYING', async () => {
    const stale = generationJob(GenerationJobStatus.RUNNING);
    const terminal = { ...stale, status: GenerationJobStatus.SUCCEEDED, completedAt: timestamp };
    const transaction = {
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(terminal),
      },
    };
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
      generationJob: { findFirst: jest.fn().mockResolvedValue(stale) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const queue = { findJob: jest.fn().mockResolvedValue({ state: 'retry' }) };
    const service = serviceWith(prisma, queue);

    const result = await service.getActiveForProject('project-1', 'visitor-1');

    expect(result.job?.status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(transaction.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        status: stale.status,
        attempt: stale.attempt,
        eventSequence: stale.eventSequence,
      },
      data: { status: GenerationJobStatus.RETRYING },
    });
  });

  it('does not let a stale retry reconciliation demote a newly claimed RUNNING attempt', async () => {
    const stale = {
      ...generationJob(GenerationJobStatus.RUNNING),
      attempt: 1,
      eventSequence: 2,
      startedAt: timestamp,
    };
    const newlyClaimed = {
      ...stale,
      attempt: 2,
      eventSequence: 3,
      message: '故事内核开始执行 · 第 2 次尝试',
    };
    const transaction = {
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue(newlyClaimed),
      },
    };
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) },
      generationJob: { findFirst: jest.fn().mockResolvedValue(stale) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma, { findJob: jest.fn().mockResolvedValue({ state: 'retry' }) });

    const result = await service.getActiveForProject('project-1', 'visitor-1');

    expect(result.job).toEqual(expect.objectContaining({
      status: GenerationJobStatus.RUNNING,
      attempt: 2,
    }));
    expect(transaction.generationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        status: GenerationJobStatus.RUNNING,
        attempt: 1,
        eventSequence: 2,
      },
      data: { status: GenerationJobStatus.RETRYING },
    });
  });

  it('does not reconcile a completed queue row while a recent paid Run is still in flight', async () => {
    jest.useFakeTimers({ now: timestamp });
    try {
      const running = {
        ...generationJob(GenerationJobStatus.RUNNING),
        attempt: 2,
        eventSequence: 3,
        startedAt: timestamp,
      };
      const prisma = {
        generationJob: { findFirst: jest.fn().mockResolvedValue(running) },
        generationRun: {
          findFirst: jest.fn().mockResolvedValue({ status: 'RUNNING', startedAt: timestamp }),
        },
        $transaction: jest.fn(),
      };
      const service = serviceWith(prisma, { findJob: jest.fn().mockResolvedValue({ state: 'completed' }) });

      const result = await service.get('job-1', 'visitor-1');

      expect(result).toEqual(expect.objectContaining({
        status: GenerationJobStatus.RUNNING,
        attempt: 2,
      }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives a freshly claimed pre-provider attempt a short grace before terminal reconciliation', async () => {
    jest.useFakeTimers({ now: timestamp });
    try {
      const running = {
        ...generationJob(GenerationJobStatus.RUNNING),
        attempt: 1,
        startedAt: timestamp,
      };
      const failed = {
        ...running,
        status: GenerationJobStatus.FAILED,
        eventSequence: running.eventSequence + 1,
        completedAt: new Date(timestamp.getTime() + 30_000),
      };
      const transaction = {
        ...failedStageRepairModels(),
        generationJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(failed),
        },
        generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        generationJob: { findFirst: jest.fn().mockResolvedValue(running) },
        generationRun: { findFirst: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
      };
      const service = serviceWith(prisma, { findJob: jest.fn().mockResolvedValue({ state: 'completed' }) });

      await expect(service.get('job-1', 'visitor-1')).resolves.toEqual(
        expect.objectContaining({ status: GenerationJobStatus.RUNNING }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(30_000);
      await expect(service.get('job-1', 'visitor-1')).resolves.toEqual(
        expect.objectContaining({ status: GenerationJobStatus.FAILED }),
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('replays persisted stage events and closes after the terminal event', async () => {
    const succeeded = {
      ...generationJob(GenerationJobStatus.SUCCEEDED),
      eventSequence: 2,
      completedAt: timestamp,
    };
    const prisma = {
      generationJob: {
        findMany: jest.fn().mockResolvedValue([succeeded]),
      },
      generationJobEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            jobId: succeeded.id,
            sequence: 2,
            type: 'job:succeeded',
            stage: 'PREMISE',
            message: '故事内核已完成，请审阅并确认',
            progress: 16,
          },
        ]),
      },
    };
    const service = serviceWith(prisma);
    const received: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      service.events('job-1', 1).subscribe({
        next: (event) => received.push(event),
        error: reject,
        complete: resolve,
      });
    });

    expect(received).toEqual([
      expect.objectContaining({
        id: '2',
        data: expect.objectContaining({ type: 'job:succeeded', stage: 'PREMISE' }),
      }),
    ]);
  });

  it('keeps independent replay cursors for subscribers sharing one batched job query', async () => {
    const succeeded = {
      ...generationJob(GenerationJobStatus.SUCCEEDED),
      eventSequence: 3,
      completedAt: timestamp,
    };
    const persistedEvents = [1, 2, 3].map((sequence) => ({
      id: `event-${sequence}`,
      jobId: succeeded.id,
      sequence,
      type: sequence === 3 ? 'job:succeeded' : 'stage:start',
      stage: 'PREMISE',
      message: `event ${sequence}`,
      progress: sequence * 5,
      createdAt: timestamp,
    }));
    const prisma = {
      generationJob: { findMany: jest.fn().mockResolvedValue([succeeded]) },
      generationJobEvent: { findMany: jest.fn().mockResolvedValue(persistedEvents) },
    };
    const service = serviceWith(prisma);
    const fromStart: string[] = [];
    const afterTwo: string[] = [];
    let completed = 0;

    await new Promise<void>((resolve, reject) => {
      const onComplete = () => {
        completed += 1;
        if (completed === 2) resolve();
      };
      service.events(succeeded.id).subscribe({
        next: (event) => fromStart.push(String(event.id)),
        error: reject,
        complete: onComplete,
      });
      service.events(succeeded.id, 2).subscribe({
        next: (event) => afterTwo.push(String(event.id)),
        error: reject,
        complete: onComplete,
      });
    });

    expect(prisma.generationJob.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.generationJobEvent.findMany).toHaveBeenCalledTimes(1);
    expect(fromStart).toEqual(['1', '2', '3']);
    expect(afterTwo).toEqual(['3']);
  });

  it('repairs terminal FAILED consistency before an SSE stream completes', async () => {
    const failed = terminalFailedJob();
    const repairModels = failedStageRepairModels('PREMISE');
    const transactionEvent = jest.fn();
    const transaction = {
      ...repairModels,
      generationJob: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(failed),
      },
      generationJobEvent: { create: transactionEvent },
    };
    const prisma = {
      generationJob: { findMany: jest.fn().mockResolvedValue([failed]) },
      generationJobEvent: {
        findMany: jest.fn().mockResolvedValue([{
          jobId: failed.id,
          sequence: failed.eventSequence,
          type: 'error',
          stage: failed.stage,
          message: failed.safeErrorMessage,
          progress: 0,
        }]),
      },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const service = serviceWith(prisma);
    const received: unknown[] = [];

    await new Promise<void>((resolve, reject) => {
      service.events(failed.id, failed.eventSequence - 1).subscribe({
        next: (event) => received.push(event),
        error: reject,
        complete: resolve,
      });
    });

    expect(repairModels.generationRun.updateMany).toHaveBeenCalledTimes(1);
    expect(repairModels.project.updateMany).toHaveBeenCalledTimes(1);
    expect(transactionEvent).not.toHaveBeenCalled();
    expect(received).toEqual([
      expect.objectContaining({
        id: String(failed.eventSequence),
        data: expect.objectContaining({ type: 'error', projectId: failed.projectId }),
      }),
    ]);
  });

  it('repairs a RUNNING business job from a completed queue job and closes the SSE stream', async () => {
    try {
      const stale = {
        ...generationJob(GenerationJobStatus.RUNNING),
        attempt: 1,
        startedAt: timestamp,
      };
      const reconciled = {
        ...stale,
        status: GenerationJobStatus.FAILED,
        eventSequence: stale.eventSequence + 1,
        completedAt: timestamp,
      };
      const persistedEvents: Array<Record<string, unknown>> = [];
      const createEvent = jest.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          persistedEvents.push(data);
          return data;
        },
      );
      const transaction = {
        ...failedStageRepairModels(),
        generationJob: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue(reconciled),
        },
        generationJobEvent: { create: createEvent },
      };
      const prisma = {
        generationJob: {
          findMany: jest.fn().mockResolvedValue([stale]),
        },
        generationRun: {
          findFirst: jest.fn().mockResolvedValue({ status: 'FAILED', startedAt: timestamp }),
        },
        generationJobEvent: {
          findMany: jest.fn().mockImplementation(() => Promise.resolve([...persistedEvents])),
        },
        $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
      };
      const queue = { findJob: jest.fn().mockResolvedValue({ state: 'completed' }) };
      const service = serviceWith(prisma, queue);
      const received: unknown[] = [];
      let completed = false;
      let streamError: unknown;
      let settleStream: () => void = () => undefined;
      const streamSettled = new Promise<void>((resolve) => {
        settleStream = resolve;
      });
      let pollDeadline: ReturnType<typeof setTimeout> | undefined;

      const subscription = service.events('job-1').subscribe({
        next: (event) => received.push(event),
        error: (error) => {
          streamError = error;
          settleStream();
        },
        complete: () => {
          completed = true;
          settleStream();
        },
      });
      await Promise.race([
        streamSettled,
        new Promise<void>((resolve) => {
          pollDeadline = setTimeout(resolve, 250);
        }),
      ]);
      if (pollDeadline) clearTimeout(pollDeadline);
      subscription.unsubscribe();

      expect(streamError).toBeUndefined();
      expect(prisma.generationJob.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['job-1'] } },
      });
      expect(queue.findJob).toHaveBeenCalledTimes(1);
      // One CAS transitions RUNNING -> FAILED; the second is the idempotent
      // terminal consistency guard before SSE completion.
      expect(transaction.generationJob.updateMany).toHaveBeenCalledTimes(2);
      expect(createEvent).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sequence: reconciled.eventSequence,
          type: 'error',
        }),
      });
      expect(received).toEqual([
        expect.objectContaining({
          id: String(reconciled.eventSequence),
          data: expect.objectContaining({ type: 'error' }),
        }),
      ]);
      expect(completed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('checks an active queue at most once per 15 seconds while SSE polling continues', async () => {
    jest.useFakeTimers({ now: timestamp });
    let subscription: ReturnType<ReturnType<GenerationJobsService['events']>['subscribe']> | undefined;
    try {
      const running = {
        ...generationJob(GenerationJobStatus.RUNNING),
        attempt: 1,
        startedAt: timestamp,
      };
      const prisma = {
        generationJob: { findMany: jest.fn().mockResolvedValue([running]) },
        generationJobEvent: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const queue = { findJob: jest.fn().mockResolvedValue({ state: 'active' }) };
      const service = serviceWith(prisma, queue);
      let completed = false;
      let streamError: unknown;

      subscription = service.events('job-1').subscribe({
        error: (error) => {
          streamError = error;
        },
        complete: () => {
          completed = true;
        },
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(queue.findJob).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(14_999);
      expect(queue.findJob).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(1);
      expect(queue.findJob).toHaveBeenCalledTimes(2);
      expect(completed).toBe(false);
      expect(streamError).toBeUndefined();
    } finally {
      subscription?.unsubscribe();
      jest.useRealTimers();
    }
  });

  it('coalesces 100 active SSE streams into one job query and one event query per poll', async () => {
    jest.useFakeTimers({ now: timestamp });
    const subscriptions: Array<
      ReturnType<ReturnType<GenerationJobsService['events']>['subscribe']>
    > = [];
    try {
      const jobs = Array.from({ length: 100 }, (_, index) => ({
        ...generationJob(GenerationJobStatus.RUNNING),
        id: `job-${index + 1}`,
        projectId: `project-${index + 1}`,
        attempt: 1,
        startedAt: timestamp,
      }));
      const findJobs = jest.fn().mockImplementation(({ where }) => {
        const ids = new Set<string>(where.id.in);
        return Promise.resolve(jobs.filter((job) => ids.has(job.id)));
      });
      const findEvents = jest.fn().mockResolvedValue([]);
      const prisma = {
        generationJob: { findMany: findJobs },
        generationJobEvent: { findMany: findEvents },
      };
      const queue = { findJob: jest.fn().mockResolvedValue({ state: 'active' }) };
      const service = serviceWith(prisma, queue);

      for (const job of jobs) subscriptions.push(service.events(job.id).subscribe());
      await jest.advanceTimersByTimeAsync(0);

      expect(findJobs).toHaveBeenCalledTimes(1);
      expect(findEvents).toHaveBeenCalledTimes(1);
      expect(queue.findJob).toHaveBeenCalledTimes(100);
      expect(findJobs.mock.calls[0][0].where.id.in).toHaveLength(100);
      expect(findEvents.mock.calls[0][0].where.OR).toHaveLength(100);

      await jest.advanceTimersByTimeAsync(750);
      expect(findJobs).toHaveBeenCalledTimes(2);
      expect(findEvents).toHaveBeenCalledTimes(2);
      expect(queue.findJob).toHaveBeenCalledTimes(100);

      await jest.advanceTimersByTimeAsync(16_775);
      expect(findJobs).toHaveBeenCalledTimes(24);
      expect(findEvents).toHaveBeenCalledTimes(24);
      expect(queue.findJob).toHaveBeenCalledTimes(200);
    } finally {
      for (const subscription of subscriptions) subscription.unsubscribe();
      jest.useRealTimers();
    }
  });

  it('commits stage content and succeeded job state through one transaction callback', async () => {
    let worker: ((job: never) => Promise<void>) | undefined;
    const current = generationJob();
    const jobStore = alwaysClaimedJobStore(current);
    const transaction = {
      generationJob: jobStore.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
      },
    };
    const prisma = {
      generationJob: { findUnique: jest.fn().mockResolvedValue(current) },
      generationJobEvent: transaction.generationJobEvent,
      generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      project: {
        findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
      },
      $transaction: jest.fn().mockImplementation((input) => input(transaction)),
    };
    const queue = {
      registerWorker: jest.fn().mockImplementation((handler) => {
        worker = handler;
        return Promise.resolve('worker-1');
      }),
    };
    const generation = {
      executeStage: jest.fn().mockImplementation(
        async (_projectId, _visitorId, _jobId, versionId, stage, emit, onCompleted) => {
          await emit(transaction, {
            type: 'stage:start',
            stage,
            message: '扩展故事前提与主题',
            progress: 5,
            projectId: 'project-1',
          });
          await onCompleted(transaction, versionId, stage, {
            type: 'stage:complete',
            stage,
            message: '故事内核完成',
            progress: 16,
            projectId: 'project-1',
          });
        },
      ),
    };
    const release = jest.fn();
    const abuseProtection = { acquireGenerationSlot: jest.fn().mockReturnValue(release) };
    const service = serviceWith(prisma, queue, generation, abuseProtection);
    await service.onModuleInit();

    await worker?.({
      data: {
        jobId: 'job-1',
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      },
      retryCount: 0,
      retryLimit: 2,
    } as never);

    expect(jobStore.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: GenerationJobStatus.SUCCEEDED }),
      }),
    );
    expect(transaction.generationJobEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'job:succeeded' }) }),
    );
    expect(prisma.project.findUnique).toHaveBeenCalled();
    expect(transaction.project.findUnique).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it('fails a queued job without calling the model when trend risk changes', async () => {
    let worker: ((job: never) => Promise<void>) | undefined;
    const current = generationJob();
    const jobStore = alwaysClaimedJobStore(current);
    const transaction = {
      ...failedStageRepairModels(),
      generationJob: jobStore.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      generationJob: { findUnique: jest.fn().mockResolvedValue(current) },
      project: {
        findUnique: jest.fn().mockResolvedValue({
          mode: 'TREND_INSPIRED',
          trendTopic: { riskLevel: 'REVIEW' },
        }),
      },
      generationRun: { updateMany: jest.fn() },
      $transaction: jest.fn().mockImplementation((input) => input(transaction)),
    };
    const queue = {
      registerWorker: jest.fn().mockImplementation((handler) => {
        worker = handler;
        return Promise.resolve('worker-1');
      }),
    };
    const generation = { executeStage: jest.fn() };
    const release = jest.fn();
    const abuseProtection = { acquireGenerationSlot: jest.fn().mockReturnValue(release) };
    const service = serviceWith(prisma, queue, generation, abuseProtection);
    await service.onModuleInit();

    await worker?.({
      data: {
        jobId: 'job-1',
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      },
      retryCount: 0,
      retryLimit: 2,
    } as never);

    expect(generation.executeStage).not.toHaveBeenCalled();
    expect(jobStore.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: GenerationJobStatus.FAILED,
        safeErrorMessage: '热点风险状态已经变化；人工复核完成前不能继续生成',
      }),
    }));
    expect(release).toHaveBeenCalled();
  });

  it.each([GenerationJobStatus.SUCCEEDED, GenerationJobStatus.FAILED])(
    'skips a redelivered terminal %s job before acquiring a worker slot',
    async (status) => {
      const prisma = { generationJob: { findUnique: jest.fn().mockResolvedValue(generationJob(status)) } };
      const generation = { executeStage: jest.fn() };
      const acquireGenerationSlot = jest.fn();
      const service = serviceWith(prisma, {}, generation, { acquireGenerationSlot });
      const process = (service as unknown as {
        process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
      }).process.bind(service);

      await expect(
        process({
          data: {
            jobId: 'job-1',
            projectId: 'project-1',
            visitorId: 'visitor-1',
            versionId: 'version-1',
            stage: 'PREMISE',
          },
          retryCount: 1,
          retryLimit: 2,
        }),
      ).resolves.toBeUndefined();

      expect(acquireGenerationSlot).not.toHaveBeenCalled();
      expect(generation.executeStage).not.toHaveBeenCalled();
    },
  );

  it('lets only one overlapping delivery with the same retryCount cross the attempt claim', async () => {
    const store = casJobStore(generationJob());
    const transaction = {
      generationJob: store.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      generationJob: { findUnique: store.findUnique },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    let releaseExecution: (() => void) | undefined;
    let markExecutionStarted: (() => void) | undefined;
    const executionStarted = new Promise<void>((resolve) => {
      markExecutionStarted = resolve;
    });
    const generation = {
      executeStage: jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseExecution = resolve;
            markExecutionStarted?.();
          }),
      ),
    };
    const releaseSlot = jest.fn();
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(releaseSlot),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);
    const queueJob = {
      data: {
        jobId: 'job-1',
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      },
      retryCount: 0,
      retryLimit: 2,
    };

    const first = process(queueJob);
    await executionStarted;
    await expect(process(queueJob)).resolves.toBeUndefined();

    expect(generation.executeStage).toHaveBeenCalledTimes(1);
    expect(store.read().attempt).toBe(1);
    expect(transaction.generationJobEvent.create).toHaveBeenCalledTimes(1);
    expect(transaction.generationJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'job:running', sequence: 2 }),
    });

    releaseExecution?.();
    await first;
    expect(releaseSlot).toHaveBeenCalledTimes(2);
  });

  it('claims a newer retry after a worker crash left the previous attempt RUNNING', async () => {
    const crashed = {
      ...generationJob(GenerationJobStatus.RUNNING),
      attempt: 1,
      startedAt: timestamp,
    };
    const store = casJobStore(crashed);
    const transaction = {
      generationJob: store.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      generationJob: { findUnique: store.findUnique },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const generation = { executeStage: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(jest.fn()),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);

    await process({
      data: {
        jobId: 'job-1',
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      },
      retryCount: 1,
      retryLimit: 2,
    });

    expect(store.read()).toEqual(expect.objectContaining({
      status: GenerationJobStatus.RUNNING,
      attempt: 2,
    }));
    expect(generation.executeStage).toHaveBeenCalledTimes(1);
    expect(generation.executeStage).toHaveBeenCalledWith(
      'project-1',
      'visitor-1',
      'job-1',
      'version-1',
      'PREMISE',
      expect.any(Function),
      expect.any(Function),
      2,
    );
  });

  it('rethrows an unconfirmed claim transaction error and lets the next queue retry claim', async () => {
    const store = casJobStore(generationJob());
    const transaction = {
      generationJob: store.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const claimFailure = new Error('claim transaction unavailable');
    let failClaim = true;
    const prisma = {
      generationJob: { findUnique: store.findUnique },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((callback) => {
        if (failClaim) {
          failClaim = false;
          return Promise.reject(claimFailure);
        }
        return callback(transaction);
      }),
    };
    const generation = { executeStage: jest.fn().mockResolvedValue(undefined) };
    const releaseSlot = jest.fn();
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(releaseSlot),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);
    const data = {
      jobId: 'job-1',
      projectId: 'project-1',
      visitorId: 'visitor-1',
      versionId: 'version-1',
      stage: 'PREMISE',
    };

    await expect(process({ data, retryCount: 0, retryLimit: 2 })).rejects.toBe(claimFailure);
    expect(store.read()).toEqual(expect.objectContaining({ status: GenerationJobStatus.QUEUED, attempt: 0 }));
    expect(generation.executeStage).not.toHaveBeenCalled();
    expect(transaction.generationJobEvent.create).not.toHaveBeenCalled();

    await expect(process({ data, retryCount: 1, retryLimit: 2 })).resolves.toBeUndefined();
    expect(store.read().attempt).toBe(2);
    expect(generation.executeStage).toHaveBeenCalledTimes(1);
    expect(releaseSlot).toHaveBeenCalledTimes(2);
  });

  it('recovers when a non-first claim rolls back and the queue retryCount advances again', async () => {
    const retrying = {
      ...generationJob(GenerationJobStatus.RETRYING),
      attempt: 1,
      startedAt: timestamp,
    };
    const store = casJobStore(retrying);
    const transaction = {
      generationJob: store.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const claimFailure = new Error('second delivery claim rolled back');
    let failClaim = true;
    const prisma = {
      generationJob: { findUnique: store.findUnique },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((callback) => {
        if (failClaim) {
          failClaim = false;
          return Promise.reject(claimFailure);
        }
        return callback(transaction);
      }),
    };
    const generation = { executeStage: jest.fn().mockResolvedValue(undefined) };
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(jest.fn()),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);
    const data = {
      jobId: 'job-1',
      projectId: 'project-1',
      visitorId: 'visitor-1',
      versionId: 'version-1',
      stage: 'PREMISE',
    };

    await expect(process({ data, retryCount: 1, retryLimit: 3 })).rejects.toBe(claimFailure);
    expect(store.read()).toEqual(expect.objectContaining({
      status: GenerationJobStatus.RETRYING,
      attempt: 1,
    }));

    await expect(process({ data, retryCount: 2, retryLimit: 3 })).resolves.toBeUndefined();
    expect(store.read().attempt).toBe(3);
    expect(generation.executeStage).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite a concurrent SUCCEEDED job when an older retry finds a prior run', async () => {
    const retrying = {
      ...generationJob(GenerationJobStatus.RETRYING),
      attempt: 1,
      startedAt: timestamp,
    };
    const store = casJobStore(retrying);
    let resolvePreviousRun: ((value: { id: string }) => void) | undefined;
    let markLookupStarted: (() => void) | undefined;
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve;
    });
    const previousRun = new Promise<{ id: string }>((resolve) => {
      resolvePreviousRun = resolve;
    });
    const eventCreate = jest.fn().mockResolvedValue({});
    const runUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      generationJob: store.model,
      generationJobEvent: { create: eventCreate },
      generationRun: {
        findFirst: jest.fn().mockImplementation(() => {
          markLookupStarted?.();
          return previousRun;
        }),
        updateMany: runUpdate,
      },
    };
    const prisma = {
      generationJob: { findUnique: store.findUnique },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
    };
    const generation = { executeStage: jest.fn() };
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(jest.fn()),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);

    const operation = process({
      data: {
        jobId: 'job-1',
        projectId: 'project-1',
        visitorId: 'visitor-1',
        versionId: 'version-1',
        stage: 'PREMISE',
      },
      retryCount: 1,
      retryLimit: 2,
    });
    await lookupStarted;
    store.force({ status: GenerationJobStatus.SUCCEEDED, completedAt: timestamp });
    resolvePreviousRun?.({ id: 'run-previous' });
    await operation;

    expect(store.read().status).toBe(GenerationJobStatus.SUCCEEDED);
    expect(runUpdate).not.toHaveBeenCalled();
    expect(generation.executeStage).not.toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalledTimes(1);
    expect(eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'job:running' }),
    });
  });

  it('stops a redelivery with any prior run from the same job window', async () => {
    const current = {
      ...generationJob(GenerationJobStatus.RETRYING),
      attempt: 1,
      startedAt: timestamp,
    };
    const jobStore = alwaysClaimedJobStore(current);
    const transaction = {
      ...failedStageRepairModels(),
      generationRun: {
        findFirst: jest.fn().mockResolvedValue({ id: 'run-previous' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      generationJob: jobStore.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      generationJob: { findUnique: jest.fn().mockResolvedValue(current) },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((input) => input(transaction)),
    };
    const generation = { executeStage: jest.fn() };
    const release = jest.fn();
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(release),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);

    await expect(
      process({
        data: {
          jobId: 'job-1',
          projectId: 'project-1',
          visitorId: 'visitor-1',
          versionId: 'version-1',
          stage: 'PREMISE',
        },
        retryCount: 1,
        retryLimit: 2,
      }),
    ).resolves.toBeUndefined();

    expect(transaction.generationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          versionId: 'version-1',
          stage: 'PREMISE',
          startedAt: { gte: current.queuedAt },
        }),
      }),
    );
    expect(transaction.generationRun.updateMany).toHaveBeenCalled();
    expect(jobStore.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: GenerationJobStatus.FAILED,
          safeErrorMessage: expect.stringContaining('避免重复计费'),
        }),
      }),
    );
    expect(generation.executeStage).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not retry a paid failure when persisting the terminal event also fails', async () => {
    const current = generationJob();
    const jobStore = alwaysClaimedJobStore(current);
    const transaction = {
      generationRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      generationJob: jobStore.model,
      generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    let transactionCall = 0;
    const prisma = {
      generationJob: { findUnique: jest.fn().mockResolvedValue(current) },
      project: { findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }) },
      $transaction: jest.fn().mockImplementation((input) => {
        transactionCall += 1;
        if (transactionCall === 3) return Promise.reject(new Error('failure-state database write failed'));
        return input(transaction);
      }),
    };
    const failure = new NonRetryableGenerationError('result commit failed', 'result_persistence');
    const generation = { executeStage: jest.fn().mockRejectedValue(failure) };
    const release = jest.fn();
    const service = serviceWith(prisma, {}, generation, {
      acquireGenerationSlot: jest.fn().mockReturnValue(release),
    });
    const process = (service as unknown as {
      process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
    }).process.bind(service);

    await expect(
      process({
        data: {
          jobId: 'job-1',
          projectId: 'project-1',
          visitorId: 'visitor-1',
          versionId: 'version-1',
          stage: 'PREMISE',
        },
        retryCount: 0,
        retryLimit: 2,
      }),
    ).resolves.toBeUndefined();

    expect(generation.executeStage).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'authentication',
      new LlmRequestError('provider failed', 'authentication', false, 401),
      GenerationJobStatus.FAILED,
      false,
    ],
    [
      'provider_unavailable',
      new LlmRequestError('provider failed', 'provider_unavailable', false, 503),
      GenerationJobStatus.FAILED,
      false,
    ],
    [
      'invalid_output',
      new NonRetryableGenerationError('invalid output', 'invalid_output'),
      GenerationJobStatus.FAILED,
      false,
    ],
    ['unclassified_pre_provider', new Error('database read failed'), GenerationJobStatus.RETRYING, true],
  ] as const)(
    'uses explicit retryability for %s failures',
    async (_kind, failure, expectedStatus, shouldReject) => {
      const current = generationJob();
      const jobStore = alwaysClaimedJobStore(current);
      const transaction = {
        ...failedStageRepairModels(),
        generationJob: jobStore.model,
        generationJobEvent: { create: jest.fn().mockResolvedValue({}) },
        generationRun: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      const prisma = {
        generationJob: { findUnique: jest.fn().mockResolvedValue(current) },
        generationRun: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        project: {
          findUnique: jest.fn().mockResolvedValue({ mode: 'ORIGINAL', trendTopic: null }),
        },
        $transaction: jest.fn().mockImplementation((input) => input(transaction)),
      };
      const generation = { executeStage: jest.fn().mockRejectedValue(failure) };
      const release = jest.fn();
      const service = serviceWith(
        prisma,
        {},
        generation,
        { acquireGenerationSlot: jest.fn().mockReturnValue(release) },
      );
      const process = (service as unknown as {
        process: (job: { data: Record<string, string>; retryCount: number; retryLimit: number }) => Promise<void>;
      }).process.bind(service);
      const operation = process({
        data: {
          jobId: 'job-1',
          projectId: 'project-1',
          visitorId: 'visitor-1',
          versionId: 'version-1',
          stage: 'PREMISE',
        },
        retryCount: 0,
        retryLimit: 2,
      });

      if (shouldReject) await expect(operation).rejects.toBe(failure);
      else await expect(operation).resolves.toBeUndefined();
      expect(jobStore.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: expectedStatus }),
      }));
      if (expectedStatus === GenerationJobStatus.FAILED) {
        expect(transaction.generationRun.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              versionId: 'version-1',
              stage: 'PREMISE',
              status: 'RUNNING',
            }),
            data: expect.objectContaining({ status: 'FAILED' }),
          }),
        );
        expect(transaction.project.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: 'project-1',
              status: 'GENERATING',
              jobs: { none: { status: { in: expect.any(Array) } } },
            }),
            data: expect.objectContaining({ status: 'REVIEWING' }),
          }),
        );
      }
      expect(release).toHaveBeenCalledTimes(1);
    },
  );
});
