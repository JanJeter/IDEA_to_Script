import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type { Db, JobWithMetadata, PgBoss } from 'pg-boss';
import type { StageKey } from './generation.types';

export const GENERATION_QUEUE = 'screenplay-generation';
export const PROJECT_CLEANUP_QUEUE = 'expired-project-cleanup';

export type GenerationQueuePayload = {
  jobId: string;
  projectId: string;
  visitorId: string;
  versionId: string;
  stage: StageKey;
};

type GenerationWorker = (job: JobWithMetadata<GenerationQueuePayload>) => Promise<void>;
type CleanupWorker = (job: JobWithMetadata<Record<string, never>>) => Promise<void>;

@Injectable()
export class GenerationQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationQueueService.name);
  private readonly retryLimit: number;
  private readonly expireInSeconds: number;
  private readonly generationConcurrency: number;
  private readonly shutdownTimeoutMs: number;
  private boss?: PgBoss;
  private starting?: Promise<PgBoss>;

  constructor(private readonly config: ConfigService) {
    this.retryLimit = this.integer('JOB_RETRY_LIMIT', 2, 0, 5);
    this.generationConcurrency = this.integer('GENERATION_CONCURRENCY', 1, 1, 10);
    const providerTimeout = this.integer('LLM_TIMEOUT_MS', 90_000, 1_000, 300_000);
    const agentTimeout = this.integer('AGENT_TIMEOUT_MS', 90_000, 1_000, 300_000);
    // The legacy adapter can make two serial requests when a provider explicitly
    // rejects response_format. Agent timeout already covers the whole agent run.
    this.shutdownTimeoutMs = Math.max(providerTimeout * 2, agentTimeout) + 30_000;
    // An operator-provided short expiry must not create a second delivery while
    // the first handler can still be inside the paid-call and persistence window.
    const configuredExpire = this.integer('JOB_EXPIRE_SECONDS', 900, 60, 3600);
    this.expireInSeconds = Math.max(
      configuredExpire,
      Math.ceil(this.shutdownTimeoutMs / 1_000) + 30,
    );
  }

  async onModuleInit() {
    await this.ensureStarted();
  }

  async onModuleDestroy() {
    if (this.boss) await this.boss.stop({ graceful: true, timeout: this.shutdownTimeoutMs });
  }

  async registerWorker(worker: GenerationWorker) {
    const boss = await this.ensureStarted();
    return boss.work(
      GENERATION_QUEUE,
      {
        includeMetadata: true,
        localConcurrency: this.generationConcurrency,
        pollingIntervalSeconds: 1,
        notifyPollingIntervalSeconds: 1,
        burstWhenReadyExceeds: 1,
        heartbeatRefreshSeconds: 30,
      },
      async ([job]: JobWithMetadata<GenerationQueuePayload>[]) => worker(job),
    );
  }

  async registerCleanupWorker(worker: CleanupWorker) {
    const boss = await this.ensureStarted();
    return boss.work(
      PROJECT_CLEANUP_QUEUE,
      { includeMetadata: true, localConcurrency: 1, pollingIntervalSeconds: 5 },
      async ([job]: JobWithMetadata<Record<string, never>>[]) => worker(job),
    );
  }

  async ready() {
    const boss = await this.ensureStarted();
    const [installed, queue] = await Promise.all([
      boss.isInstalled(),
      boss.getQueue(GENERATION_QUEUE),
    ]);
    if (!installed || !queue) throw new Error('Generation queue is not ready');
  }

  async enqueue(
    transaction: Prisma.TransactionClient,
    jobId: string,
    payload: GenerationQueuePayload,
  ) {
    const boss = await this.ensureStarted();
    const queuedId = await boss.send(GENERATION_QUEUE, payload, {
      id: jobId,
      singletonKey: payload.projectId,
      db: this.transactionDatabase(transaction),
    });
    if (!queuedId) throw new Error('生成任务未能进入队列');
    return queuedId;
  }

  async findJob(jobId: string) {
    const boss = await this.ensureStarted();
    const [job] = await boss.findJobs<GenerationQueuePayload>(GENERATION_QUEUE, { id: jobId });
    return job ?? null;
  }

  private async ensureStarted() {
    if (this.boss) return this.boss;
    if (this.starting) return this.starting;

    this.starting = (async () => {
      const connectionString = this.config.get<string>('DATABASE_URL');
      if (!connectionString) throw new Error('DATABASE_URL is required for the generation queue');

      const { PgBoss: PgBossConstructor } = await import('pg-boss');
      const boss = new PgBossConstructor({
        connectionString,
        schema: 'pgboss',
        max: 3,
        useListenNotify: true,
      });
      boss.on('error', (error) => this.logger.error(error.message));
      boss.on('warning', (warning) => this.logger.warn(JSON.stringify(warning)));
      await boss.start();
      await boss.createQueue(GENERATION_QUEUE, {
        policy: 'singleton',
        retryLimit: this.retryLimit,
        retryDelay: 5,
        retryBackoff: true,
        retryDelayMax: 60,
        heartbeatSeconds: 60,
        expireInSeconds: this.expireInSeconds,
        retentionSeconds: 7 * 24 * 60 * 60,
        deleteAfterSeconds: 7 * 24 * 60 * 60,
        notify: true,
      });
      await boss.createQueue(PROJECT_CLEANUP_QUEUE, {
        policy: 'singleton',
        retryLimit: 2,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 10 * 60,
        retentionSeconds: 7 * 24 * 60 * 60,
        deleteAfterSeconds: 7 * 24 * 60 * 60,
        notify: true,
      });
      await boss.schedule(
        PROJECT_CLEANUP_QUEUE,
        '0 3 * * *',
        {},
        { key: 'daily-expired-project-cleanup', tz: 'Asia/Shanghai' },
      );
      this.boss = boss;
      return boss;
    })();

    try {
      return await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private transactionDatabase(transaction: Prisma.TransactionClient): Db {
    return {
      executeSql: async (text, values = []) => {
        const rows = await transaction.$queryRawUnsafe<Record<string, unknown>[]>(text, ...values);
        return { rows };
      },
    };
  }

  private integer(key: string, fallback: number, minimum: number, maximum: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value) || value < minimum) return fallback;
    return Math.min(value, maximum);
  }
}
