import { createRequire } from 'node:module';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AbuseProtectionService,
  retrySerializableTransaction,
  SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS,
} from './abuse-protection.service';

const loadCommonJs = createRequire(__filename);
const { solveChallenge } = loadCommonJs('altcha-lib') as {
  solveChallenge: (options: Record<string, unknown>) => Promise<unknown>;
};
const { deriveKey } = loadCommonJs('altcha-lib/algorithms/pbkdf2') as {
  deriveKey: (...arguments_: unknown[]) => Promise<unknown>;
};

function serializationFailure() {
  return new Prisma.PrismaClientKnownRequestError('Serializable transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  });
}

function rawSerializationFailure(sqlState = '40001') {
  return new Prisma.PrismaClientKnownRequestError('Raw query failed', {
    code: 'P2010',
    clientVersion: 'test',
    meta: { code: sqlState },
  });
}

describe('retrySerializableTransaction', () => {
  it('retries P2034 with exponential backoff and jitter before succeeding', async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(serializationFailure())
      .mockRejectedValueOnce(serializationFailure())
      .mockResolvedValue('committed');
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      retrySerializableTransaction(operation, {
        maxAttempts: 4,
        baseDelayMs: 10,
        maxDelayMs: 100,
        random: () => 0.5,
        sleep,
      }),
    ).resolves.toBe('committed');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[15], [30]]);
  });

  it('turns an exhausted P2034 into HTTP 503 instead of leaking a 500', async () => {
    const operation = jest.fn().mockRejectedValue(serializationFailure());
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(
      retrySerializableTransaction(operation, {
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 100,
        sleep,
        exhaustedMessage: '事务繁忙',
      }),
    ).rejects.toMatchObject({ status: 503, message: '事务繁忙' });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it.each(['40001', '40P01'])(
    'retries pg-boss raw-query SQLSTATE %s instead of leaking P2010',
    async (sqlState) => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(rawSerializationFailure(sqlState))
        .mockResolvedValue('committed');
      const sleep = jest.fn().mockResolvedValue(undefined);

      await expect(
        retrySerializableTransaction(operation, { sleep, random: () => 0 }),
      ).resolves.toBe('committed');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry application errors', async () => {
    const applicationError = new ForbiddenException('quota reached');
    const operation = jest.fn().mockRejectedValue(applicationError);
    const sleep = jest.fn();

    await expect(retrySerializableTransaction(operation, { sleep })).rejects.toBe(
      applicationError,
    );
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('AbuseProtectionService', () => {
  const project = { findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }) };
  const prisma = { project };
  const config = new ConfigService({
    ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
    IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
    ALTCHA_COST: '25',
    GENERATION_CONCURRENCY: '1',
  });

  beforeEach(() => project.findFirst.mockClear());

  it('uses defaults sized for about 100 invited users', () => {
    const service = new AbuseProtectionService(config, prisma as never);

    expect(Reflect.get(service, 'ipProjectDailyLimit')).toBe(200);
    expect(Reflect.get(service, 'visitorGenerationDailyLimit')).toBe(3);
    expect(Reflect.get(service, 'ipGenerationDailyLimit')).toBe(100);
    expect(Reflect.get(service, 'globalGenerationDailyLimit')).toBe(100);
    expect(Reflect.get(service, 'globalGenerationMonthlyLimit')).toBe(3000);
    expect(Reflect.get(service, 'serializableTransactionConcurrency')).toBe(1);
    expect(Reflect.get(service, 'serializableTransactionQueueLimit')).toBe(256);
    expect(Reflect.get(service, 'serializableTransactionWaitTimeoutMs')).toBe(15_000);
  });

  it('retries the whole project transaction and reserves the IP quota atomically', async () => {
    const transaction = {
      project: { count: jest.fn().mockResolvedValue(0) },
      dailyIpQuota: {
        upsert: jest.fn().mockResolvedValue({ projectsCreated: 1 }),
      },
    };
    let attempts = 0;
    const localPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) => {
          const result = await callback(transaction);
          attempts += 1;
          if (attempts === 1) throw serializationFailure();
          return result;
        },
      ),
    };
    const service = new AbuseProtectionService(config, localPrisma as never);
    const create = jest.fn().mockResolvedValue('created');

    await expect(service.createOwnedProject('visitor-1', '127.0.0.1', create)).resolves.toBe(
      'created',
    );

    expect(localPrisma.$transaction).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(transaction.dailyIpQuota.upsert).toHaveBeenLastCalledWith({
      where: { ipHash_day: { ipHash: expect.any(String), day: expect.any(String) } },
      create: {
        ipHash: expect.any(String),
        day: expect.any(String),
        projectsCreated: 1,
      },
      update: { projectsCreated: { increment: 1 } },
      select: { projectsCreated: true },
    });
    expect(SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS).toBe(8);
  });

  it('bounds in-process Serializable transactions to avoid a retry stampede', async () => {
    const transaction = {};
    const localPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
      ),
    };
    const service = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        LOCAL_UNLIMITED_MODE: 'true',
        SERIALIZABLE_TRANSACTION_CONCURRENCY: '1',
      }),
      localPrisma as never,
    );
    let finishFirst: (() => void) | undefined;
    const firstCreate = jest.fn(
      () => new Promise<string>((resolve) => (finishFirst = () => resolve('first'))),
    );
    const secondCreate = jest.fn().mockResolvedValue('second');

    const first = service.createOwnedProject('visitor-1', '127.0.0.1', firstCreate);
    await Promise.resolve();
    const second = service.createOwnedProject('visitor-2', '127.0.0.2', secondCreate);
    await Promise.resolve();

    expect(firstCreate).toHaveBeenCalledTimes(1);
    expect(secondCreate).not.toHaveBeenCalled();
    finishFirst?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(secondCreate).toHaveBeenCalledTimes(1);
  });

  it('releases a Serializable transaction slot when the operation throws', async () => {
    const transaction = {};
    const localPrisma = {
      $transaction: jest
        .fn()
        .mockRejectedValueOnce(new Error('application failure'))
        .mockImplementationOnce(
          async (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
    };
    const service = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        LOCAL_UNLIMITED_MODE: 'true',
        SERIALIZABLE_TRANSACTION_CONCURRENCY: '1',
      }),
      localPrisma as never,
    );

    await expect(
      service.createOwnedProject('visitor-1', '127.0.0.1', jest.fn()),
    ).rejects.toThrow('application failure');
    await expect(
      service.createOwnedProject('visitor-2', '127.0.0.2', jest.fn().mockResolvedValue('created')),
    ).resolves.toBe('created');
    expect(localPrisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects excess Serializable waiters instead of growing an unbounded queue', async () => {
    const transaction = {};
    const localPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
      ),
    };
    const service = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        LOCAL_UNLIMITED_MODE: 'true',
        SERIALIZABLE_TRANSACTION_CONCURRENCY: '1',
        SERIALIZABLE_TRANSACTION_QUEUE_LIMIT: '1',
        SERIALIZABLE_TRANSACTION_WAIT_TIMEOUT_MS: '1000',
      }),
      localPrisma as never,
    );
    let finishFirst: (() => void) | undefined;
    const first = service.createOwnedProject(
      'visitor-1',
      '127.0.0.1',
      () => new Promise<string>((resolve) => (finishFirst = () => resolve('first'))),
    );
    await Promise.resolve();
    const second = service.createOwnedProject(
      'visitor-2',
      '127.0.0.2',
      jest.fn().mockResolvedValue('second'),
    );
    await Promise.resolve();

    await expect(
      service.createOwnedProject(
        'visitor-3',
        '127.0.0.3',
        jest.fn().mockResolvedValue('third'),
      ),
    ).rejects.toMatchObject({ status: 503, message: '并发请求队列已满，请稍后重试' });
    finishFirst?.();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('times out a queued Serializable transaction and clamps concurrency settings', async () => {
    const transaction = {};
    const localPrisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction),
      ),
    };
    const service = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        LOCAL_UNLIMITED_MODE: 'true',
        SERIALIZABLE_TRANSACTION_CONCURRENCY: '999',
        SERIALIZABLE_TRANSACTION_QUEUE_LIMIT: '9999',
        SERIALIZABLE_TRANSACTION_WAIT_TIMEOUT_MS: '999999',
      }),
      localPrisma as never,
    );
    expect(Reflect.get(service, 'serializableTransactionConcurrency')).toBe(32);
    expect(Reflect.get(service, 'serializableTransactionQueueLimit')).toBe(2048);
    expect(Reflect.get(service, 'serializableTransactionWaitTimeoutMs')).toBe(60_000);

    const timeoutService = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        LOCAL_UNLIMITED_MODE: 'true',
        SERIALIZABLE_TRANSACTION_CONCURRENCY: '1',
        SERIALIZABLE_TRANSACTION_WAIT_TIMEOUT_MS: '1',
      }),
      localPrisma as never,
    );
    let finishFirst: (() => void) | undefined;
    const first = timeoutService.createOwnedProject(
      'visitor-1',
      '127.0.0.1',
      () => new Promise<string>((resolve) => (finishFirst = () => resolve('first'))),
    );
    await Promise.resolve();
    await expect(
      timeoutService.createOwnedProject(
        'visitor-2',
        '127.0.0.2',
        jest.fn().mockResolvedValue('second'),
      ),
    ).rejects.toMatchObject({ status: 503, message: '并发请求等待超时，请稍后重试' });
    finishFirst?.();
    await expect(first).resolves.toBe('first');
  });

  it('binds a one-use proof-of-work ticket to the visitor and project', async () => {
    const service = new AbuseProtectionService(config, prisma as never);
    const challenge = await service.createChallenge('project-1', 'visitor-1', '127.0.0.1');
    const solution = await solveChallenge({ challenge, deriveKey, timeout: 10_000 });
    expect(solution).toBeTruthy();

    const authorized = await service.authorizeGeneration(
      'project-1',
      'visitor-1',
      '127.0.0.1',
      challenge,
      solution as never,
      false,
    );
    await expect(
      service.authorizeGeneration(
        'project-1',
        'visitor-1',
        '127.0.0.1',
        challenge,
        solution as never,
        false,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.consumeGenerationTicket(authorized.ticket, 'project-1', 'visitor-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.consumeGenerationTicket(authorized.ticket, 'project-1', 'visitor-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces the configured global generation concurrency', () => {
    const service = new AbuseProtectionService(config, prisma as never);
    const release = service.acquireGenerationSlot();
    expect(() => service.acquireGenerationSlot()).toThrow(ServiceUnavailableException);
    release();
    expect(() => service.acquireGenerationSlot()).not.toThrow();
  });

  it('bypasses persistent quotas in explicitly enabled local unlimited mode', async () => {
    const transaction = {
      project: { count: jest.fn() },
      dailyVisitorQuota: { upsert: jest.fn(), updateMany: jest.fn() },
      dailyIpQuota: { upsert: jest.fn(), updateMany: jest.fn() },
      globalDailyGenerationQuota: { upsert: jest.fn(), updateMany: jest.fn() },
      globalMonthlyGenerationQuota: { upsert: jest.fn(), updateMany: jest.fn() },
    };
    const localPrisma = {
      project,
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const service = new AbuseProtectionService(
      new ConfigService({
        ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
        IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
        ALTCHA_COST: '25',
        LOCAL_UNLIMITED_MODE: 'true',
      }),
      localPrisma as never,
    );

    const create = jest.fn().mockResolvedValue('created');
    await expect(service.createOwnedProject('visitor-1', '127.0.0.1', create)).resolves.toBe('created');
    expect(transaction.project.count).not.toHaveBeenCalled();
    expect(transaction.dailyIpQuota.upsert).not.toHaveBeenCalled();

    const challenge = await service.createChallenge('project-1', 'visitor-1', '127.0.0.1');
    const solution = await solveChallenge({ challenge, deriveKey, timeout: 10_000 });
    const authorized = await service.authorizeGeneration(
      'project-1',
      'visitor-1',
      '127.0.0.1',
      challenge,
      solution as never,
      true,
    );
    const operation = jest.fn().mockResolvedValue('generated');
    await expect(
      service.consumeGenerationTicket(authorized.ticket, 'project-1', 'visitor-1', operation),
    ).resolves.toBe('generated');
    expect(transaction.dailyVisitorQuota.upsert).not.toHaveBeenCalled();
    expect(transaction.globalDailyGenerationQuota.upsert).not.toHaveBeenCalled();
  });

  it('rejects local unlimited mode in production', () => {
    const productionConfig = new ConfigService({
      NODE_ENV: 'production',
      LOCAL_UNLIMITED_MODE: 'true',
      ALTCHA_HMAC_KEY: 'test-altcha-secret-with-more-than-32-characters',
      IP_HASH_KEY: 'test-ip-secret-with-more-than-32-characters',
    });

    expect(() => new AbuseProtectionService(productionConfig, prisma as never)).toThrow(
      'LOCAL_UNLIMITED_MODE cannot be enabled in production',
    );
  });

  it.each([
    [
      'ALTCHA_HMAC_KEY',
      '  development-altcha-signing-key-change-me  ',
      'safe-ip-hash-key-with-more-than-32-characters',
    ],
    [
      'IP_HASH_KEY',
      'safe-altcha-key-with-more-than-32-characters',
      '  development-ip-hash-key-change-me  ',
    ],
  ])(
    'rejects the public development %s value with surrounding whitespace in production',
    (_key, altchaKey, ipHashKey) => {
      const productionConfig = new ConfigService({
        NODE_ENV: 'production',
        ALTCHA_HMAC_KEY: altchaKey,
        IP_HASH_KEY: ipHashKey,
      });

      expect(() => new AbuseProtectionService(productionConfig, prisma as never)).toThrow(
        'must not use public development values',
      );
    },
  );
});
