import { ProjectRetentionService } from './project-retention.service';

describe('ProjectRetentionService', () => {
  it('deletes only projects whose seven-day expiry has passed', async () => {
    let cleanup: (() => Promise<void>) | undefined;
    const queue = {
      registerCleanupWorker: jest.fn().mockImplementation((worker) => {
        cleanup = worker;
        return Promise.resolve('cleanup-worker');
      }),
    };
    const prisma = {
      project: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      anonymousVisitor: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };
    const config = { get: jest.fn((_key, fallback) => fallback) };
    const service = new ProjectRetentionService(prisma as never, queue as never, config as never);

    await service.onModuleInit();
    await cleanup?.();

    expect(prisma.project.deleteMany).toHaveBeenCalledWith({
      where: {
        expiresAt: { lte: expect.any(Date) },
        jobs: {
          none: {
            status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] },
          },
        },
      },
    });
    expect(prisma.anonymousVisitor.deleteMany).toHaveBeenCalledWith({
      where: {
        lastSeenAt: { lt: expect.any(Date) },
        projects: { none: {} },
      },
    });
  });
});
