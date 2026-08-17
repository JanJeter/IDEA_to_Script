import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('keeps liveness database-free and checks the database for readiness', async () => {
    const prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const queue = { ready: jest.fn().mockResolvedValue(undefined) };
    const controller = new HealthController(
      { isDemo: true, model: 'test-model' } as never,
      prisma as never,
      queue as never,
    );

    expect(controller.live()).toMatchObject({ status: 'ok', generationMode: 'demo' });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok' });
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
    expect(queue.ready).toHaveBeenCalledTimes(1);
  });
});
