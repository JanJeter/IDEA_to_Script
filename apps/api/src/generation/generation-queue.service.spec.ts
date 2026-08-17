import { ConfigService } from '@nestjs/config';
import type { JobWithMetadata } from 'pg-boss';
import {
  GENERATION_QUEUE,
  GenerationQueueService,
} from './generation-queue.service';
import type { GenerationQueuePayload } from './generation-queue.service';

type BossDouble = {
  work: jest.Mock;
  send: jest.Mock;
  isInstalled: jest.Mock;
  getQueue: jest.Mock;
  stop: jest.Mock;
};

function serviceWithBoss(
  values: Record<string, string> = {},
  overrides: Partial<BossDouble> = {},
) {
  const boss: BossDouble = {
    work: jest.fn().mockResolvedValue('worker-1'),
    send: jest.fn().mockResolvedValue('job-1'),
    isInstalled: jest.fn().mockResolvedValue(true),
    getQueue: jest.fn().mockResolvedValue({ name: GENERATION_QUEUE }),
    stop: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const service = new GenerationQueueService(new ConfigService(values));
  (service as unknown as { boss: BossDouble }).boss = boss;
  return { boss, service };
}

const payload: GenerationQueuePayload = {
  jobId: 'job-1',
  projectId: 'project-1',
  visitorId: 'visitor-1',
  versionId: 'version-1',
  stage: 'PREMISE',
};

describe('GenerationQueueService', () => {
  it('passes configured concurrency and fast notify backlog settings to pg-boss', async () => {
    const { boss, service } = serviceWithBoss({ GENERATION_CONCURRENCY: '4' });
    const worker = jest.fn().mockResolvedValue(undefined);

    await service.registerWorker(worker);

    expect(boss.work).toHaveBeenCalledWith(
      GENERATION_QUEUE,
      {
        includeMetadata: true,
        localConcurrency: 4,
        pollingIntervalSeconds: 1,
        notifyPollingIntervalSeconds: 1,
        burstWhenReadyExceeds: 1,
        heartbeatRefreshSeconds: 30,
      },
      expect.any(Function),
    );

    const registeredWorker = boss.work.mock.calls[0][2] as (
      jobs: JobWithMetadata<GenerationQueuePayload>[],
    ) => Promise<void>;
    const job = { id: 'job-1', data: payload } as JobWithMetadata<GenerationQueuePayload>;
    await registeredWorker([job]);
    expect(worker).toHaveBeenCalledWith(job);
  });

  it.each([
    ['missing', undefined, 1],
    ['invalid', '0', 1],
    ['above the supported maximum', '25', 10],
  ])('uses safe concurrency when the setting is %s', async (_case, setting, expected) => {
    const values: Record<string, string> =
      setting === undefined ? {} : { GENERATION_CONCURRENCY: setting };
    const { boss, service } = serviceWithBoss(values);

    await service.registerWorker(jest.fn());

    expect(boss.work).toHaveBeenCalledWith(
      GENERATION_QUEUE,
      expect.objectContaining({ localConcurrency: expected }),
      expect.any(Function),
    );
  });

  it('scopes singleton generation jobs by project without leaving the transaction', async () => {
    const { boss, service } = serviceWithBoss();
    const transaction = { $queryRawUnsafe: jest.fn() };

    await service.enqueue(transaction as never, payload.jobId, payload);

    expect(boss.send).toHaveBeenCalledWith(
      GENERATION_QUEUE,
      payload,
      expect.objectContaining({
        id: payload.jobId,
        singletonKey: payload.projectId,
        db: expect.objectContaining({ executeSql: expect.any(Function) }),
      }),
    );
  });

  it('checks the pg-boss installation and generation queue for readiness', async () => {
    const { boss, service } = serviceWithBoss();

    await expect(service.ready()).resolves.toBeUndefined();
    expect(boss.isInstalled).toHaveBeenCalledTimes(1);
    expect(boss.getQueue).toHaveBeenCalledWith(GENERATION_QUEUE);
  });

  it.each([
    [{}, 210_000],
    [{ LLM_TIMEOUT_MS: '1000', AGENT_TIMEOUT_MS: '300000' }, 330_000],
    [{ LLM_TIMEOUT_MS: '300000', AGENT_TIMEOUT_MS: '1000' }, 630_000],
  ])(
    'keeps graceful shutdown beyond two legacy calls or one whole agent run',
    async (values, expected) => {
      const { boss, service } = serviceWithBoss(values);

      await service.onModuleDestroy();

      expect(boss.stop).toHaveBeenCalledWith({ graceful: true, timeout: expected });
    },
  );

  it.each([
    [{}, 900],
    [{ JOB_EXPIRE_SECONDS: '60' }, 240],
    [{ JOB_EXPIRE_SECONDS: '60', LLM_TIMEOUT_MS: '300000' }, 660],
    [{ JOB_EXPIRE_SECONDS: '1000', LLM_TIMEOUT_MS: '300000' }, 1000],
  ])('keeps job expiry beyond the maximum paid handler window', (values, expected) => {
    const { service } = serviceWithBoss(values);

    expect((service as unknown as { expireInSeconds: number }).expireInSeconds).toBe(expected);
  });
});
