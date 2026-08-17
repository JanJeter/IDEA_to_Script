import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AltchaChallenge, AltchaSolution } from './altcha.types';

const loadCommonJs = createRequire(__filename);
const { createChallenge, verifySolution } = loadCommonJs('altcha-lib') as {
  createChallenge: (options: Record<string, unknown>) => Promise<AltchaChallenge>;
  verifySolution: (options: Record<string, unknown>) => Promise<{ verified: boolean }>;
};
const { deriveKey } = loadCommonJs('altcha-lib/algorithms/pbkdf2') as {
  deriveKey: (...arguments_: unknown[]) => Promise<unknown>;
};

type GenerationTicket = {
  projectId: string;
  visitorId: string;
  clientIp: string;
  realGeneration: boolean;
  expiresAt: number;
};

type RateWindow = { startedAt: number; count: number };
type SerializableTransactionWaiter = {
  grant: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

export const SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS = 8;
const SERIALIZABLE_TRANSACTION_BASE_DELAY_MS = 10;
const SERIALIZABLE_TRANSACTION_MAX_DELAY_MS = 500;
const DEVELOPMENT_ALTCHA_KEY = 'development-altcha-signing-key-change-me';
const DEVELOPMENT_IP_HASH_KEY = 'development-ip-hash-key-change-me';

type SerializableRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  exhaustedMessage?: string;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
};

export function isSerializableTransactionConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;

  // pg-boss executes through Prisma's raw-query adapter. PostgreSQL serialization
  // failures and deadlocks are therefore surfaced as P2010 plus the SQLSTATE.
  const sqlState = error.meta?.code;
  return error.code === 'P2010' && (sqlState === '40001' || sqlState === '40P01');
}

/**
 * Retries a complete Serializable transaction after PostgreSQL/Prisma aborts.
 * Callers must keep all non-database side effects outside the supplied operation.
 */
export async function retrySerializableTransaction<T>(
  operation: () => Promise<T>,
  options: SerializableRetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? SERIALIZABLE_TRANSACTION_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? SERIALIZABLE_TRANSACTION_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? SERIALIZABLE_TRANSACTION_MAX_DELAY_MS;
  const sleep =
    options.sleep ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === maxAttempts - 1) {
        throw new ServiceUnavailableException(
          options.exhaustedMessage ?? '并发请求较多，请稍后重试',
        );
      }

      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = Math.floor(exponentialDelay * random());
      await sleep(exponentialDelay + jitter);
    }
  }

  throw new ServiceUnavailableException(options.exhaustedMessage ?? '并发请求较多，请稍后重试');
}

@Injectable()
export class AbuseProtectionService {
  private readonly altchaSecret: string;
  private readonly altchaKeySecret: string;
  private readonly ipHashKey: string;
  private readonly localUnlimitedMode: boolean;
  private readonly projectLimit: number;
  private readonly ipProjectDailyLimit: number;
  private readonly visitorGenerationDailyLimit: number;
  private readonly ipGenerationDailyLimit: number;
  private readonly globalGenerationDailyLimit: number;
  private readonly globalGenerationMonthlyLimit: number;
  private readonly generationConcurrency: number;
  private readonly serializableTransactionConcurrency: number;
  private readonly serializableTransactionQueueLimit: number;
  private readonly serializableTransactionWaitTimeoutMs: number;
  private readonly altchaCost: number;
  private readonly challengeRateLimit: number;
  private readonly usedChallenges = new Map<string, number>();
  private readonly tickets = new Map<string, GenerationTicket>();
  private readonly challengeWindows = new Map<string, RateWindow>();
  private readonly serializableTransactionWaiters: SerializableTransactionWaiter[] = [];
  private activeGenerations = 0;
  private activeSerializableTransactions = 0;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const production = config.get('NODE_ENV') === 'production';
    const localUnlimitedMode = config.get<string>('LOCAL_UNLIMITED_MODE', 'false') === 'true';
    this.altchaSecret = (
      config.get<string>('ALTCHA_HMAC_KEY', DEVELOPMENT_ALTCHA_KEY) ?? DEVELOPMENT_ALTCHA_KEY
    ).trim();
    this.altchaKeySecret = createHmac('sha256', this.altchaSecret).update('derived-key').digest('hex');
    this.ipHashKey = (
      config.get<string>('IP_HASH_KEY', DEVELOPMENT_IP_HASH_KEY) ?? DEVELOPMENT_IP_HASH_KEY
    ).trim();

    if (production && (this.altchaSecret.length < 32 || this.ipHashKey.length < 32)) {
      throw new Error('ALTCHA_HMAC_KEY and IP_HASH_KEY must contain at least 32 characters in production');
    }
    if (
      production &&
      (this.altchaSecret === DEVELOPMENT_ALTCHA_KEY || this.ipHashKey === DEVELOPMENT_IP_HASH_KEY)
    ) {
      throw new Error('ALTCHA_HMAC_KEY and IP_HASH_KEY must not use public development values in production');
    }
    if (production && localUnlimitedMode) {
      throw new Error('LOCAL_UNLIMITED_MODE cannot be enabled in production');
    }
    this.localUnlimitedMode = localUnlimitedMode && !production;

    this.projectLimit = this.positiveInt(config, 'VISITOR_PROJECT_LIMIT', 5, 50);
    this.ipProjectDailyLimit = this.positiveInt(config, 'IP_PROJECTS_PER_DAY', 200, 500);
    this.visitorGenerationDailyLimit = this.positiveInt(config, 'VISITOR_GENERATIONS_PER_DAY', 3, 20);
    this.ipGenerationDailyLimit = this.positiveInt(config, 'IP_GENERATIONS_PER_DAY', 100, 100);
    this.globalGenerationDailyLimit = this.positiveInt(config, 'GLOBAL_GENERATIONS_PER_DAY', 100, 1000);
    this.globalGenerationMonthlyLimit = this.positiveInt(config, 'GLOBAL_GENERATIONS_PER_MONTH', 3000, 10000);
    this.generationConcurrency = this.positiveInt(config, 'GENERATION_CONCURRENCY', 1, 10);
    this.serializableTransactionConcurrency = this.positiveInt(
      config,
      'SERIALIZABLE_TRANSACTION_CONCURRENCY',
      1,
      32,
    );
    this.serializableTransactionQueueLimit = this.positiveInt(
      config,
      'SERIALIZABLE_TRANSACTION_QUEUE_LIMIT',
      256,
      2048,
    );
    this.serializableTransactionWaitTimeoutMs = this.positiveInt(
      config,
      'SERIALIZABLE_TRANSACTION_WAIT_TIMEOUT_MS',
      15_000,
      60_000,
    );
    this.altchaCost = this.positiveInt(config, 'ALTCHA_COST', 1000, 100000);
    this.challengeRateLimit = this.positiveInt(config, 'ALTCHA_CHALLENGES_PER_10_MINUTES', 20, 200);
  }

  async createChallenge(projectId: string, visitorId: string, clientIp: string) {
    await this.assertOwnProject(projectId, visitorId);
    this.purgeExpiredEntries();
    if (!this.localUnlimitedMode) this.assertChallengeRate(visitorId, clientIp);

    return createChallenge({
      algorithm: 'PBKDF2/SHA-256',
      cost: this.altchaCost,
      counter: randomInt(500, 1501),
      deriveKey,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      data: { projectId, visitorId },
      hmacSignatureSecret: this.altchaSecret,
      hmacKeySignatureSecret: this.altchaKeySecret,
      keyPrefixLength: 8,
    });
  }

  async authorizeGeneration(
    projectId: string,
    visitorId: string,
    clientIp: string,
    challenge: AltchaChallenge,
    solution: AltchaSolution,
    realGeneration: boolean,
  ) {
    await this.assertOwnProject(projectId, visitorId);
    this.purgeExpiredEntries();

    const challengeKey = challenge.signature;
    if (!challengeKey || this.usedChallenges.has(challengeKey)) {
      throw new ForbiddenException('安全验证已失效，请重试');
    }
    if (
      challenge.parameters.data?.projectId !== projectId ||
      challenge.parameters.data?.visitorId !== visitorId
    ) {
      throw new ForbiddenException('安全验证与当前项目不匹配');
    }

    const result = await verifySolution({
      challenge,
      solution,
      deriveKey,
      hmacSignatureSecret: this.altchaSecret,
      hmacKeySignatureSecret: this.altchaKeySecret,
    });
    if (!result.verified) throw new ForbiddenException('安全验证未通过，请重试');

    this.usedChallenges.set(challengeKey, Date.now() + 10 * 60 * 1000);
    this.capMap(this.usedChallenges, 10_000);
    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(this.ticketHash(ticket), {
      projectId,
      visitorId,
      clientIp,
      realGeneration,
      expiresAt: Date.now() + 2 * 60 * 1000,
    });
    this.capMap(this.tickets, 1000);
    return { ticket, expiresInSeconds: 120 };
  }

  async consumeGenerationTicket(ticket: string, projectId: string, visitorId: string): Promise<void>;
  async consumeGenerationTicket<T>(
    ticket: string,
    projectId: string,
    visitorId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  async consumeGenerationTicket<T>(
    ticket: string,
    projectId: string,
    visitorId: string,
    operation?: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T | void> {
    this.purgeExpiredEntries();
    if (!ticket || ticket.length !== 43) throw new ForbiddenException('生成凭证无效或已过期，请重新验证');
    const key = this.ticketHash(ticket);
    const record = this.tickets.get(key);
    this.tickets.delete(key);

    if (
      !record ||
      record.expiresAt < Date.now() ||
      record.projectId !== projectId ||
      record.visitorId !== visitorId
    ) {
      throw new ForbiddenException('生成凭证无效或已过期，请重新验证');
    }

    if (record.realGeneration) {
      return this.reserveRealGeneration(
        visitorId,
        record.clientIp,
        operation ?? (async () => undefined as T),
      );
    }
    if (operation) {
      return this.runSerializableTransaction(operation, '生成任务入队冲突，请稍后重试');
    }
  }

  acquireGenerationSlot() {
    if (this.activeGenerations >= this.generationConcurrency) {
      throw new ServiceUnavailableException('当前生成任务较多，请稍后再试');
    }
    this.activeGenerations += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeGenerations = Math.max(0, this.activeGenerations - 1);
    };
  }

  async createOwnedProject<T>(
    visitorId: string,
    clientIp: string,
    create: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.runSerializableTransaction(async (transaction) => {
      if (!this.localUnlimitedMode) {
        const currentProjects = await transaction.project.count({
          where: { visitorId, expiresAt: { gt: new Date() } },
        });
        if (currentProjects >= this.projectLimit) {
          throw new ForbiddenException(`匿名访客最多保留 ${this.projectLimit} 个项目，请先删除旧项目`);
        }

        const day = this.chinaDateKey();
        const ipHash = this.hashIp(clientIp, day);
        const quota = await transaction.dailyIpQuota.upsert({
          where: { ipHash_day: { ipHash, day } },
          create: { ipHash, day, projectsCreated: 1 },
          update: { projectsCreated: { increment: 1 } },
          select: { projectsCreated: true },
        });
        if (quota.projectsCreated > this.ipProjectDailyLimit) {
          throw this.tooManyRequests('当前网络今天创建的项目较多，请明天再试');
        }
      }

      return create(transaction);
    }, '项目创建冲突，请稍后重试');
  }

  private async reserveRealGeneration<T>(
    visitorId: string,
    clientIp: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ) {
    const day = this.chinaDateKey();
    const month = day.slice(0, 7);
    const ipHash = this.hashIp(clientIp, day);

    return this.runSerializableTransaction(async (transaction) => {
      if (this.localUnlimitedMode) return operation(transaction);

      const visitorQuota = await transaction.dailyVisitorQuota.upsert({
        where: { visitorId_day: { visitorId, day } },
        create: { visitorId, day, realGenerations: 1 },
        update: { realGenerations: { increment: 1 } },
        select: { realGenerations: true },
      });
      if (visitorQuota.realGenerations > this.visitorGenerationDailyLimit) {
        throw this.tooManyRequests(
          `每台设备每天最多真实生成 ${this.visitorGenerationDailyLimit} 次`,
        );
      }

      const ipQuota = await transaction.dailyIpQuota.upsert({
        where: { ipHash_day: { ipHash, day } },
        create: { ipHash, day, realGenerations: 1 },
        update: { realGenerations: { increment: 1 } },
        select: { realGenerations: true },
      });
      if (ipQuota.realGenerations > this.ipGenerationDailyLimit) {
        throw this.tooManyRequests('当前网络今天的真实生成额度已用完');
      }

      const dailyQuota = await transaction.globalDailyGenerationQuota.upsert({
        where: { day },
        create: { day, used: 1 },
        update: { used: { increment: 1 } },
        select: { used: true },
      });
      if (dailyQuota.used > this.globalGenerationDailyLimit) {
        throw this.tooManyRequests('今天的全站真实生成额度已用完，请明天再来');
      }

      const monthlyQuota = await transaction.globalMonthlyGenerationQuota.upsert({
        where: { month },
        create: { month, used: 1 },
        update: { used: { increment: 1 } },
        select: { used: true },
      });
      if (monthlyQuota.used > this.globalGenerationMonthlyLimit) {
        throw new ServiceUnavailableException('本月真实生成预算已用完，完整示例仍可正常查看');
      }

      return operation(transaction);
    }, '生成额度预占冲突，请稍后重试');
  }

  async runSerializableTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    exhaustedMessage: string,
  ) {
    return retrySerializableTransaction(
      () =>
        this.withSerializableTransactionSlot(() =>
          this.prisma.$transaction(operation, {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }),
        ),
      { exhaustedMessage },
    );
  }

  private async withSerializableTransactionSlot<T>(operation: () => Promise<T>) {
    const release = await this.acquireSerializableTransactionSlot();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async acquireSerializableTransactionSlot() {
    if (this.activeSerializableTransactions >= this.serializableTransactionConcurrency) {
      if (this.serializableTransactionWaiters.length >= this.serializableTransactionQueueLimit) {
        throw new ServiceUnavailableException('并发请求队列已满，请稍后重试');
      }

      await new Promise<void>((resolve, reject) => {
        const waiter = {} as SerializableTransactionWaiter;
        waiter.grant = () => {
          clearTimeout(waiter.timeout);
          resolve();
        };
        waiter.timeout = setTimeout(() => {
          const index = this.serializableTransactionWaiters.indexOf(waiter);
          if (index >= 0) this.serializableTransactionWaiters.splice(index, 1);
          reject(new ServiceUnavailableException('并发请求等待超时，请稍后重试'));
        }, this.serializableTransactionWaitTimeoutMs);
        this.serializableTransactionWaiters.push(waiter);
      });
    } else {
      this.activeSerializableTransactions += 1;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.serializableTransactionWaiters.shift();
      if (next) {
        next.grant();
      } else {
        this.activeSerializableTransactions = Math.max(
          0,
          this.activeSerializableTransactions - 1,
        );
      }
    };
  }

  private async assertOwnProject(projectId: string, visitorId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, visitorId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('项目不存在或已过期');
  }

  private assertChallengeRate(visitorId: string, clientIp: string) {
    const now = Date.now();
    const windowLength = 10 * 60 * 1000;
    const key = createHmac('sha256', this.ipHashKey)
      .update(`challenge\0${visitorId}\0${clientIp}`)
      .digest('hex');
    const current = this.challengeWindows.get(key);

    if (!current || current.startedAt + windowLength < now) {
      this.challengeWindows.set(key, { startedAt: now, count: 1 });
      this.capMap(this.challengeWindows, 5000);
      return;
    }
    if (current.count >= this.challengeRateLimit) {
      throw this.tooManyRequests('安全验证请求过于频繁，请十分钟后再试');
    }
    current.count += 1;
  }

  private hashIp(clientIp: string, day: string) {
    return createHmac('sha256', this.ipHashKey).update(`${day}\0${clientIp}`).digest('hex');
  }

  private ticketHash(ticket: string) {
    return createHash('sha256').update(ticket).digest('hex');
  }

  private chinaDateKey() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  private purgeExpiredEntries() {
    const now = Date.now();
    for (const [key, expiresAt] of this.usedChallenges) {
      if (expiresAt < now) this.usedChallenges.delete(key);
    }
    for (const [key, ticket] of this.tickets) {
      if (ticket.expiresAt < now) this.tickets.delete(key);
    }
    for (const [key, window] of this.challengeWindows) {
      if (window.startedAt + 10 * 60 * 1000 < now) this.challengeWindows.delete(key);
    }
  }

  private capMap<Key, Value>(map: Map<Key, Value>, maximum: number) {
    while (map.size > maximum) {
      const oldest = map.keys().next();
      if (oldest.done) return;
      map.delete(oldest.value);
    }
  }

  private positiveInt(config: ConfigService, key: string, fallback: number, maximum: number) {
    const value = Number(config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value) || value < 1) return fallback;
    return Math.min(value, maximum);
  }

  private tooManyRequests(message: string) {
    return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
