import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GenerationJob,
  GenerationJobEvent,
  GenerationJobStatus,
  GenerationVersionStatus,
  Prisma,
  ProjectMode,
} from '@prisma/client';
import type { JobWithMetadata } from 'pg-boss';
import { Observable, Subscriber } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import {
  AbuseProtectionService,
  isSerializableTransactionConflict,
} from '../security/abuse-protection.service';
import {
  GenerationQueueService,
  type GenerationQueuePayload,
} from './generation-queue.service';
import { NonRetryableGenerationError } from './generation-error';
import { GenerationService } from './generation.service';
import { LlmRequestError } from './llm.service';
import type { GenerationEvent, StageKey } from './generation.types';
import { nextStage } from './generation.types';

const activeStatuses: GenerationJobStatus[] = [
  GenerationJobStatus.QUEUED,
  GenerationJobStatus.RUNNING,
  GenerationJobStatus.RETRYING,
];

const terminalStatuses: GenerationJobStatus[] = [
  GenerationJobStatus.SUCCEEDED,
  GenerationJobStatus.FAILED,
];

const trendRiskConflictMessage = '热点风险状态已经变化；人工复核完成前不能继续生成';
const interruptedUnknownMessage =
  '检测到当前任务已有结果未知的执行记录；为避免重复计费，系统未自动重试，请手动重新开始当前阶段';
const ssePollIntervalMs = 750;
const ssePollBatchSize = 200;
const sseQueueReconcileIntervalMs = 15_000;
const preProviderReconcileGraceMs = 30_000;

type SseStreamState = {
  jobId: string;
  visitorId: string;
  connectedAt: number;
  cursor: number;
  lastHeartbeat: number;
  lastQueueReconcile: number;
  stopped: boolean;
  subscriber: Subscriber<MessageEvent>;
};

@Injectable()
export class GenerationJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GenerationJobsService.name);
  private readonly regenerationLimit: number;
  private readonly localUnlimitedMode: boolean;
  private readonly inFlightRunReconcileGraceMs: number;
  private readonly sseStreams = new Set<SseStreamState>();
  private ssePollTimer?: NodeJS.Timeout;
  private ssePollInProgress = false;
  private ssePollRequested = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: GenerationQueueService,
    private readonly generation: GenerationService,
    private readonly abuseProtection: AbuseProtectionService,
    config: ConfigService,
  ) {
    const configuredLimit = Number(config.get<string>('PROJECT_REGENERATIONS_MAX', '3'));
    this.regenerationLimit = Number.isInteger(configuredLimit)
      ? Math.min(10, Math.max(0, configuredLimit))
      : 3;
    this.localUnlimitedMode =
      config.get('NODE_ENV') !== 'production' &&
      config.get<string>('LOCAL_UNLIMITED_MODE', 'false') === 'true';
    const providerTimeout = this.boundedInteger(config, 'LLM_TIMEOUT_MS', 90_000, 1_000, 300_000);
    const agentTimeout = this.boundedInteger(config, 'AGENT_TIMEOUT_MS', 90_000, 1_000, 300_000);
    this.inFlightRunReconcileGraceMs = Math.max(providerTimeout * 2, agentTimeout) + 30_000;
  }

  async onModuleInit() {
    if (this.configRestoreVerifyMode()) return;
    await this.queue.registerWorker((job) => this.process(job));
  }

  private configRestoreVerifyMode() {
    return process.env.RESTORE_VERIFY_MODE === 'true';
  }

  onModuleDestroy() {
    if (this.ssePollTimer) clearTimeout(this.ssePollTimer);
    this.ssePollTimer = undefined;
    for (const stream of [...this.sseStreams]) this.completeSseStream(stream);
  }

  async enqueue(projectId: string, visitorId: string, ticket: string) {
    await this.queue.ready();
    const jobId = randomUUID();

    try {
      const job = await this.abuseProtection.consumeGenerationTicket(
        ticket,
        projectId,
        visitorId,
        async (transaction) => {
          const version = await this.generation.prepareDraft(
            transaction,
            projectId,
            visitorId,
          );
          const created = await this.createQueuedJob(
            transaction,
            { jobId, projectId, visitorId, versionId: version.id, stage: 'PREMISE' },
            '故事内核已进入生成队列',
          );
          await transaction.generationVersion.update({
            where: { id: version.id },
            data: { jobId: created.id },
          });
          return created;
        },
      );
      return this.toPublicJob(job);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async regenerateStage(projectId: string, visitorId: string, rawStage: string, ticket?: string) {
    await this.queue.ready();
    const stage = this.generation.parseStage(rawStage);

    try {
      const operation = () => this.abuseProtection.runSerializableTransaction(
          async (transaction) => {
          await this.assertOwnedProject(transaction, projectId, visitorId);
          await this.assertNoActiveJob(transaction, projectId);
          const version = await transaction.generationVersion.findFirst({
            where: { projectId, status: 'STAGING' },
          });
          if (!version) throw new NotFoundException('阶段草稿不存在');
          const retryingFirstStage = stage === 'PREMISE' && version.currentStage === 'IDEA';
          if (
            (!retryingFirstStage && version.currentStage !== stage) ||
            version.confirmedStage === stage
          ) {
            throw new ConflictException('只能重新生成当前等待确认的阶段');
          }
          if (!retryingFirstStage && !this.localUnlimitedMode) {
            const reserved = await transaction.project.updateMany({
              where: { id: projectId, regenerationsUsed: { lt: this.regenerationLimit } },
              data: { regenerationsUsed: { increment: 1 } },
            });
            if (reserved.count !== 1) {
              throw new ConflictException(`每个项目最多重新生成 ${this.regenerationLimit} 次`);
            }
          }
          const created = await this.createQueuedJob(
            transaction,
            {
              jobId: randomUUID(),
              projectId,
              visitorId,
              versionId: version.id,
              stage,
            },
            `${this.stageLabel(stage)}已进入重新生成队列`,
          );
          await transaction.project.update({
            where: { id: projectId },
            data: { status: 'GENERATING', currentStage: stage },
          });
          return created;
        },
          '重新生成任务入队冲突，请稍后重试',
        );
      const job = ticket
        ? await this.abuseProtection.consumeGenerationTicket(ticket, projectId, visitorId, operation)
        : await operation();
      return this.toPublicJob(job);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async confirmStage(projectId: string, visitorId: string, rawStage: string) {
    await this.queue.ready();
    const stage = this.generation.parseStage(rawStage);

    try {
      const result = await this.abuseProtection.runSerializableTransaction(
        async (transaction) => {
          await this.assertOwnedProject(transaction, projectId, visitorId);
          await this.assertNoActiveJob(transaction, projectId);
          const version = await transaction.generationVersion.findFirst({
            where: { projectId, status: 'STAGING' },
          });
          if (!version) throw new NotFoundException('阶段草稿不存在');
          if (version.currentStage !== stage) {
            throw new ConflictException('只能确认当前阶段');
          }

          const followingStage = nextStage(stage);
          if (!followingStage) {
            await this.assertTrendGenerationAllowed(transaction, projectId);
            await this.generation.activateDraft(
              transaction,
              projectId,
              visitorId,
              version.id,
            );
            const scriptJob = await transaction.generationJob.findFirst({
              where: {
                projectId,
                versionId: version.id,
                stage: 'SCRIPT',
                status: GenerationJobStatus.SUCCEEDED,
              },
              orderBy: { completedAt: 'desc' },
              select: { id: true },
            });
            if (scriptJob) {
              await transaction.generationJob.update({
                where: { id: scriptJob.id },
                data: { resultVersionId: version.id },
              });
            }
            return { job: null, completed: true };
          }

          if (version.confirmedStage !== stage) {
            await transaction.generationVersion.update({
              where: { id: version.id },
              data: { confirmedStage: stage },
            });
          }
          const job = await this.createQueuedJob(
            transaction,
            {
              jobId: randomUUID(),
              projectId,
              visitorId,
              versionId: version.id,
              stage: followingStage,
            },
            `${this.stageLabel(followingStage)}已进入生成队列`,
          );
          await transaction.project.update({
            where: { id: projectId },
            data: { status: 'GENERATING', currentStage: followingStage },
          });
          return { job, completed: false };
        },
        '确认阶段并进入下一阶段时发生冲突，请稍后重试',
      );
      return { ...result, job: result.job ? this.toPublicJob(result.job) : null };
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async get(jobId: string, visitorId: string) {
    let job = await this.prisma.generationJob.findFirst({
      where: { id: jobId, project: { visitorId, expiresAt: { gt: new Date() } } },
    });
    if (!job) throw new NotFoundException('生成任务不存在');

    if (!terminalStatuses.includes(job.status)) job = await this.reconcileQueueState(job);
    else if (job.status === GenerationJobStatus.FAILED) {
      job = await this.repairTerminalFailedConsistency(job);
    }
    return this.toPublicJob(job);
  }

  async getActiveForProject(projectId: string, visitorId: string) {
    await this.assertOwnedProject(this.prisma, projectId, visitorId);
    const job = await this.prisma.generationJob.findFirst({
      where: { projectId, status: { in: activeStatuses } },
      orderBy: { queuedAt: 'desc' },
    });
    if (job) return { job: this.toPublicJob(await this.reconcileQueueState(job)) };

    const latestFailure = await this.prisma.generationJob.findFirst({
      where: { projectId, status: GenerationJobStatus.FAILED },
      orderBy: { completedAt: 'desc' },
    });
    if (latestFailure) await this.repairTerminalFailedConsistency(latestFailure);
    return { job: null };
  }

  events(jobId: string, visitorIdOrAfter: string | number = '', maybeAfterSequence = 0): Observable<MessageEvent> {
    const legacyCall = typeof visitorIdOrAfter === 'number' || visitorIdOrAfter === '';
    const visitorId = legacyCall ? 'legacy-test-visitor' : visitorIdOrAfter;
    const afterSequence = legacyCall && typeof visitorIdOrAfter === 'number' ? visitorIdOrAfter : maybeAfterSequence;
    return new Observable<MessageEvent>((subscriber) => {
      const visitorStreams = [...this.sseStreams].filter((stream) => stream.visitorId === visitorId);
      if (!legacyCall && (visitorStreams.length >= 6 || this.sseStreams.size >= 256)) {
        subscriber.error(new ServiceUnavailableException('实时连接数量已达上限，请关闭重复页面后重试'));
        return undefined;
      }
      const stream: SseStreamState = {
        jobId,
        visitorId,
        connectedAt: Date.now(),
        cursor: Math.max(0, afterSequence),
        lastHeartbeat: Date.now(),
        lastQueueReconcile: Number.NEGATIVE_INFINITY,
        stopped: false,
        subscriber,
      };
      this.sseStreams.add(stream);
      this.scheduleSsePoll(0);
      return () => this.removeSseStream(stream);
    });
  }

  private scheduleSsePoll(delayMs: number) {
    if (this.sseStreams.size === 0) return;
    if (this.ssePollInProgress) {
      this.ssePollRequested = true;
      return;
    }
    if (this.ssePollTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.ssePollTimer);
    }
    this.ssePollTimer = setTimeout(() => {
      this.ssePollTimer = undefined;
      void this.pollSseStreams();
    }, delayMs);
  }

  private async pollSseStreams() {
    if (this.ssePollInProgress || this.sseStreams.size === 0) return;
    this.ssePollInProgress = true;
    this.ssePollRequested = false;
    try {
      const now = Date.now();
      for (const stream of [...this.sseStreams]) {
        if (now - stream.connectedAt > 30 * 60 * 1000) this.completeSseStream(stream);
      }
      const streamsByJob = new Map<string, SseStreamState[]>();
      for (const stream of this.sseStreams) {
        if (stream.stopped) continue;
        const streams = streamsByJob.get(stream.jobId) ?? [];
        streams.push(stream);
        streamsByJob.set(stream.jobId, streams);
      }
      const jobIds = [...streamsByJob.keys()];
      for (let offset = 0; offset < jobIds.length; offset += ssePollBatchSize) {
        const batchIds = jobIds.slice(offset, offset + ssePollBatchSize);
        try {
          await this.pollSseBatch(batchIds, streamsByJob);
        } catch (error) {
          for (const jobId of batchIds) {
            for (const stream of streamsByJob.get(jobId) ?? []) {
              this.failSseStream(stream, error);
            }
          }
        }
      }
    } catch (error) {
      for (const stream of [...this.sseStreams]) this.failSseStream(stream, error);
    } finally {
      this.ssePollInProgress = false;
      if (this.sseStreams.size > 0) {
        this.scheduleSsePoll(this.ssePollRequested ? 0 : ssePollIntervalMs);
      }
    }
  }

  private async pollSseBatch(
    jobIds: string[],
    streamsByJob: Map<string, SseStreamState[]>,
  ) {
    if (jobIds.length === 0) return;
    const jobs = await this.prisma.generationJob.findMany({ where: { id: { in: jobIds } } });
    const jobsById = new Map(jobs.map((job) => [job.id, job]));

    for (const jobId of jobIds) {
      if (jobsById.has(jobId)) continue;
      for (const stream of streamsByJob.get(jobId) ?? []) this.completeSseStream(stream);
    }

    await Promise.all(
      jobs.map(async (snapshot) => {
        const streams = (streamsByJob.get(snapshot.id) ?? []).filter((stream) => !stream.stopped);
        if (streams.length === 0) return;
        let current = snapshot;
        try {
          const now = Date.now();
          if (
            !terminalStatuses.includes(current.status) &&
            streams.some(
              (stream) =>
                now - stream.lastQueueReconcile >= sseQueueReconcileIntervalMs,
            )
          ) {
            for (const stream of streams) stream.lastQueueReconcile = now;
            current = await this.reconcileQueueState(current);
          }
          if (current.status === GenerationJobStatus.FAILED) {
            current = await this.repairTerminalFailedConsistency(current);
          }
          jobsById.set(current.id, current);
        } catch (error) {
          jobsById.delete(snapshot.id);
          for (const stream of streams) this.failSseStream(stream, error);
        }
      }),
    );

    const eventConditions = [...jobsById.keys()]
      .map((jobId) => {
        const streams = (streamsByJob.get(jobId) ?? []).filter((stream) => !stream.stopped);
        if (streams.length === 0) return null;
        return {
          jobId,
          sequence: { gt: Math.min(...streams.map((stream) => stream.cursor)) },
        };
      })
      .filter((condition): condition is { jobId: string; sequence: { gt: number } } => !!condition);
    if (eventConditions.length === 0) return;

    const persistedEvents = await this.prisma.generationJobEvent.findMany({
      where: { OR: eventConditions },
      orderBy: [{ jobId: 'asc' }, { sequence: 'asc' }],
    });
    const eventsByJob = new Map<string, GenerationJobEvent[]>();
    for (const event of persistedEvents) {
      const events = eventsByJob.get(event.jobId) ?? [];
      events.push(event);
      eventsByJob.set(event.jobId, events);
    }

    for (const [jobId, job] of jobsById) {
      const events = eventsByJob.get(jobId) ?? [];
      for (const stream of streamsByJob.get(jobId) ?? []) {
        if (stream.stopped) continue;
        for (const event of events) {
          if (event.sequence <= stream.cursor) continue;
          stream.cursor = event.sequence;
          stream.subscriber.next({
            id: String(event.sequence),
            data: {
              type: event.type as GenerationEvent['type'],
              stage: (event.stage ?? undefined) as StageKey | undefined,
              message: event.message,
              progress: event.progress,
              projectId: job.projectId,
            } satisfies GenerationEvent,
          });
        }
        if (terminalStatuses.includes(job.status) && stream.cursor >= job.eventSequence) {
          this.completeSseStream(stream);
          continue;
        }
        if (Date.now() - stream.lastHeartbeat >= 15_000) {
          stream.subscriber.next({ type: 'heartbeat', data: { jobId } });
          stream.lastHeartbeat = Date.now();
        }
      }
    }
  }

  private completeSseStream(stream: SseStreamState) {
    if (stream.stopped) return;
    stream.stopped = true;
    this.sseStreams.delete(stream);
    stream.subscriber.complete();
    this.clearSseTimerIfIdle();
  }

  private failSseStream(stream: SseStreamState, error: unknown) {
    if (stream.stopped) return;
    stream.stopped = true;
    this.sseStreams.delete(stream);
    stream.subscriber.error(error);
    this.clearSseTimerIfIdle();
  }

  private removeSseStream(stream: SseStreamState) {
    stream.stopped = true;
    this.sseStreams.delete(stream);
    this.clearSseTimerIfIdle();
  }

  private clearSseTimerIfIdle() {
    if (this.sseStreams.size > 0 || !this.ssePollTimer) return;
    clearTimeout(this.ssePollTimer);
    this.ssePollTimer = undefined;
  }

  private async process(job: JobWithMetadata<GenerationQueuePayload>) {
    const current = await this.prisma.generationJob.findUnique({ where: { id: job.data.jobId } });
    if (!current || terminalStatuses.includes(current.status)) return;

    const expectedAttempt = job.retryCount + 1;
    const releaseSlot = this.abuseProtection.acquireGenerationSlot();
    let attemptClaimed = false;
    try {
      const claimed = await this.claimAttempt(current, job.data, job.retryCount);
      if (!claimed) return;
      attemptClaimed = true;
      await this.assertTrendGenerationAllowed(this.prisma, job.data.projectId);
      if (await this.stopPreviouslyAttemptedJob(claimed, job.data, expectedAttempt)) {
        this.logger.warn(
          `Generation job ${job.data.jobId} stopped because a previous paid attempt has an unknown outcome`,
        );
        return;
      }

      await this.generation.executeStage(
        job.data.projectId,
        job.data.visitorId,
        job.data.jobId,
        job.data.versionId,
        job.data.stage,
        (transaction, event) =>
          this.appendEventInTransaction(transaction, job.data.jobId, event, {
            status: GenerationJobStatus.RUNNING,
            progress: event.progress,
            currentStage: event.stage,
            message: event.message,
          }).then(() => undefined),
        async (transaction, versionId, stage, completionEvent) => {
          await this.assertTrendGenerationAllowed(transaction, job.data.projectId);
          await this.appendEventInTransaction(transaction, job.data.jobId, completionEvent, {
            status: GenerationJobStatus.RUNNING,
            progress: completionEvent.progress,
            currentStage: stage,
            message: completionEvent.message,
          });
          await this.appendEventInTransaction(
            transaction,
            job.data.jobId,
            {
              type: 'job:succeeded',
              stage,
              message: `${this.stageLabel(stage)}已完成，请审阅并确认`,
              progress: completionEvent.progress,
              projectId: job.data.projectId,
            },
            {
              status: GenerationJobStatus.SUCCEEDED,
              progress: completionEvent.progress,
              currentStage: stage,
              message: `${this.stageLabel(stage)}已完成，请审阅并确认`,
              versionId,
              completedAt: new Date(),
              safeErrorMessage: null,
            },
          );
        },
        expectedAttempt,
      );
    } catch (error) {
      // A claim transaction error means no worker attempt was confirmed. Let
      // pg-boss retry instead of trying (and usually failing) to persist an
      // event for an attempt we do not own. If the commit succeeded but its
      // acknowledgement was lost, the next retry can recover RUNNING/attempt=N
      // through claimAttempt's crash-recovery branch.
      if (!attemptClaimed) throw error;
      const blockedByTrendRisk = this.isTrendRiskConflict(error);
      const classifiedFailure =
        error instanceof LlmRequestError || error instanceof NonRetryableGenerationError;
      const retryableFailure = !classifiedFailure || error.retryable;
      const retrying = !blockedByTrendRisk && retryableFailure && job.retryCount < job.retryLimit;
      const message = blockedByTrendRisk
        ? trendRiskConflictMessage
        : retrying
          ? `${this.stageLabel(job.data.stage)}遇到临时问题，将自动重试（${job.retryCount + 1}/${job.retryLimit + 1}）`
          : `${this.stageLabel(job.data.stage)}生成失败，已完成内容仍然保留，请重试`;
      try {
        const persisted = await this.appendAttemptEvent(
          job.data.jobId,
          expectedAttempt,
          {
            type: retrying ? 'job:retrying' : 'error',
            stage: job.data.stage,
            message,
            progress: 0,
            projectId: job.data.projectId,
          },
          {
            status: retrying ? GenerationJobStatus.RETRYING : GenerationJobStatus.FAILED,
            progress: 0,
            message,
            safeErrorMessage: message,
            completedAt: retrying ? null : new Date(),
          },
        );
        if (!persisted) return;
      } catch (stateError) {
        this.logger.error(
          `Generation job ${job.data.jobId} could not persist its failure state`,
          stateError instanceof Error ? stateError.stack : String(stateError),
        );
        // Never let a secondary DB failure turn a provider/paid-result failure
        // into an automatic retry. Once pg-boss completes, reconcileQueueState
        // can repair the business Job status when the database is healthy.
        if (blockedByTrendRisk || !retryableFailure) return;
      }
      if (blockedByTrendRisk) {
        this.logger.warn(`Generation job ${job.data.jobId} stopped because the linked trend requires review`);
        return;
      }
      if (!retryableFailure) {
        const failureKind = classifiedFailure ? error.kind : 'unclassified';
        this.logger.warn(
          `Generation job ${job.data.jobId} stopped after non-retryable ${failureKind} failure`,
        );
        return;
      }
      this.logger.error(
        `Generation job ${job.data.jobId} stage ${job.data.stage} attempt ${job.retryCount + 1} failed`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    } finally {
      releaseSlot();
    }
  }

  private stopPreviouslyAttemptedJob(
    current: GenerationJob,
    payload: GenerationQueuePayload,
    expectedAttempt: number,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const previousRun = await transaction.generationRun.findFirst({
        where: {
          versionId: payload.versionId,
          stage: payload.stage,
          startedAt: { gte: current.queuedAt },
        },
        select: { id: true },
      });
      if (!previousRun) return false;

      const stopped = await transaction.generationJob.updateMany({
        where: {
          id: payload.jobId,
          status: { in: activeStatuses },
          attempt: expectedAttempt,
        },
        data: {
          status: GenerationJobStatus.FAILED,
          progress: 0,
          message: interruptedUnknownMessage,
          safeErrorMessage: interruptedUnknownMessage,
          completedAt: new Date(),
          eventSequence: { increment: 1 },
        },
      });
      if (stopped.count === 0) {
        await transaction.generationJob.findUnique({ where: { id: payload.jobId } });
        return true;
      }

      const stoppedJob = await transaction.generationJob.findUnique({
        where: { id: payload.jobId },
      });
      if (!stoppedJob) return true;
      await this.repairFailedStage(
        transaction,
        stoppedJob,
        'Worker interrupted after a provider attempt; automatic retry suppressed',
      );
      await transaction.generationJobEvent.create({
        data: {
          jobId: payload.jobId,
          sequence: stoppedJob.eventSequence,
          type: 'error',
          stage: payload.stage,
          message: interruptedUnknownMessage,
          progress: 0,
        },
      });
      return true;
    });
  }

  private claimAttempt(
    current: GenerationJob,
    payload: GenerationQueuePayload,
    retryCount: number,
  ) {
    const expectedAttempt = retryCount + 1;
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.generationJob.updateMany({
        where: {
          id: payload.jobId,
          OR: [
            { status: GenerationJobStatus.QUEUED, attempt: 0 },
            { status: GenerationJobStatus.RETRYING, attempt: { lte: retryCount } },
            { status: GenerationJobStatus.RUNNING, attempt: { lte: retryCount } },
          ],
        },
        data: {
          status: GenerationJobStatus.RUNNING,
          attempt: expectedAttempt,
          progress: 2,
          message: `${this.stageLabel(payload.stage)}开始执行 · 第 ${expectedAttempt} 次尝试`,
          completedAt: null,
          safeErrorMessage: null,
          eventSequence: { increment: 1 },
        },
      });
      if (claimed.count === 0) return null;

      let claimedJob = await transaction.generationJob.findUnique({ where: { id: payload.jobId } });
      if (!claimedJob) return null;
      if (!claimedJob.startedAt) {
        claimedJob = await transaction.generationJob.update({
          where: { id: payload.jobId },
          data: { startedAt: current.startedAt ?? new Date() },
        });
      }
      await transaction.generationJobEvent.create({
        data: {
          jobId: payload.jobId,
          sequence: claimedJob.eventSequence,
          type: 'job:running',
          stage: payload.stage,
          message: claimedJob.message,
          progress: 2,
        },
      });
      return claimedJob;
    });
  }

  private appendAttemptEvent(
    jobId: string,
    expectedAttempt: number,
    event: GenerationEvent,
    update: Prisma.GenerationJobUncheckedUpdateManyInput,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.generationJob.updateMany({
        where: {
          id: jobId,
          status: { in: activeStatuses },
          attempt: expectedAttempt,
        },
        data: { ...update, eventSequence: { increment: 1 } },
      });
      if (claimed.count === 0) return false;
      const current = await transaction.generationJob.findUnique({ where: { id: jobId } });
      if (!current) return false;
      if (current.status === GenerationJobStatus.FAILED) {
        await this.repairFailedStage(transaction, current, event.message);
      }
      await transaction.generationJobEvent.create({
        data: {
          jobId,
          sequence: current.eventSequence,
          type: event.type,
          stage: event.stage,
          message: event.message,
          progress: event.progress,
        },
      });
      return true;
    });
  }

  private appendEvent(
    jobId: string,
    event: GenerationEvent,
    update: Prisma.GenerationJobUncheckedUpdateInput,
  ) {
    return this.prisma.$transaction((transaction) =>
      this.appendEventInTransaction(transaction, jobId, event, update),
    );
  }

  private async appendEventInTransaction(
    transaction: Prisma.TransactionClient,
    jobId: string,
    event: GenerationEvent,
    update: Prisma.GenerationJobUncheckedUpdateInput,
  ) {
    const job = await transaction.generationJob.update({
      where: { id: jobId },
      data: { ...update, eventSequence: { increment: 1 } },
    });
    await transaction.generationJobEvent.create({
      data: {
        jobId,
        sequence: job.eventSequence,
        type: event.type,
        stage: event.stage,
        message: event.message,
        progress: event.progress,
      },
    });
    return job;
  }

  private async createQueuedJob(
    transaction: Prisma.TransactionClient,
    payload: GenerationQueuePayload,
    message: string,
  ) {
    await this.assertTrendGenerationAllowed(transaction, payload.projectId);
    const created = await transaction.generationJob.create({
      data: {
        id: payload.jobId,
        projectId: payload.projectId,
        versionId: payload.versionId,
        stage: payload.stage,
        status: GenerationJobStatus.QUEUED,
        progress: 1,
        currentStage: payload.stage,
        message,
        eventSequence: 1,
        events: {
          create: {
            sequence: 1,
            type: 'job:queued',
            stage: payload.stage,
            message,
            progress: 1,
          },
        },
      },
    });
    await this.queue.enqueue(transaction, created.id, payload);
    return created;
  }

  private async assertTrendGenerationAllowed(
    transaction: Prisma.TransactionClient | PrismaService,
    projectId: string,
  ) {
    const project = await transaction.project.findUnique({
      where: { id: projectId },
      select: {
        mode: true,
        trendTopic: { select: { riskLevel: true } },
      },
    });
    if (project?.mode !== ProjectMode.TREND_INSPIRED) return;
    if (!project.trendTopic || project.trendTopic.riskLevel !== 'LOW') {
      throw new ConflictException(trendRiskConflictMessage);
    }
  }

  private isTrendRiskConflict(error: unknown) {
    return error instanceof ConflictException && error.message === trendRiskConflictMessage;
  }

  private assertNoActiveJob(transaction: Prisma.TransactionClient, projectId: string) {
    return transaction.generationJob
      .findFirst({
        where: { projectId, status: { in: activeStatuses } },
        select: { id: true },
      })
      .then((active) => {
        if (active) throw new ConflictException('这个项目已经有生成任务在进行中');
      });
  }

  private async assertOwnedProject(
    transaction: Prisma.TransactionClient | PrismaService,
    projectId: string,
    visitorId: string,
  ) {
    const project = await transaction.project.findFirst({
      where: { id: projectId, visitorId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('项目不存在或已过期');
  }

  private async reconcileQueueState(job: GenerationJob): Promise<GenerationJob> {
    const queued = await this.queue.findJob(job.id);
    if (
      !queued ||
      queued.state === 'failed' ||
      queued.state === 'cancelled' ||
      queued.state === 'completed'
    ) {
      if (await this.shouldDeferTerminalReconciliation(job)) return job;
      const message = '生成任务已停止，已完成内容仍然保留，请重新开始当前阶段';
      return this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.generationJob.updateMany({
          where: {
            id: job.id,
            status: job.status,
            attempt: job.attempt,
            eventSequence: job.eventSequence,
          },
          data: {
            status: GenerationJobStatus.FAILED,
            progress: 0,
            message,
            safeErrorMessage: message,
            completedAt: new Date(),
            eventSequence: { increment: 1 },
          },
        });
        const current = await transaction.generationJob.findUnique({ where: { id: job.id } });
        if (!current) throw new NotFoundException('生成任务不存在');
        if (claimed.count === 0) return current;

        await this.repairFailedStage(transaction, current, message);
        await transaction.generationJobEvent.create({
          data: {
            jobId: job.id,
            sequence: current.eventSequence,
            type: 'error',
            stage: (job.stage || undefined) as StageKey | undefined,
            message,
            progress: 0,
          },
        });
        return current;
      });
    }
    if (queued.state === 'retry' && job.status !== GenerationJobStatus.RETRYING) {
      return this.prisma.$transaction(async (transaction) => {
        await transaction.generationJob.updateMany({
          where: {
            id: job.id,
            status: job.status,
            attempt: job.attempt,
            eventSequence: job.eventSequence,
          },
          data: { status: GenerationJobStatus.RETRYING },
        });
        const current = await transaction.generationJob.findUnique({ where: { id: job.id } });
        if (!current) throw new NotFoundException('生成任务不存在');
        return current;
      });
    }
    return job;
  }

  private async repairTerminalFailedConsistency(job: GenerationJob): Promise<GenerationJob> {
    if (job.status !== GenerationJobStatus.FAILED) return job;
    if (job.safeErrorMessage === interruptedUnknownMessage && job.versionId) {
      const latestRun = await this.prisma.generationRun.findFirst({
        where: {
          versionId: job.versionId,
          stage: job.stage,
          startedAt: {
            gte: job.queuedAt,
            ...(job.completedAt ? { lte: job.completedAt } : {}),
          },
          status: 'RUNNING',
        },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true },
      });
      if (
        latestRun &&
        Date.now() - latestRun.startedAt.getTime() < this.inFlightRunReconcileGraceMs
      ) {
        return job;
      }
    }

    return this.prisma.$transaction(async (transaction) => {
      const ownsSnapshot = await transaction.generationJob.updateMany({
        where: {
          id: job.id,
          status: GenerationJobStatus.FAILED,
          attempt: job.attempt,
          eventSequence: job.eventSequence,
        },
        data: { status: GenerationJobStatus.FAILED },
      });
      const current = await transaction.generationJob.findUnique({ where: { id: job.id } });
      if (!current) throw new NotFoundException('生成任务不存在');
      if (ownsSnapshot.count === 0) return current;
      await this.repairFailedStage(transaction, current, current.safeErrorMessage ?? current.message);
      return current;
    });
  }

  private async repairFailedStage(
    transaction: Prisma.TransactionClient,
    job: GenerationJob,
    runError: string,
  ) {
    const failureBoundary = job.completedAt ?? new Date();
    if (job.versionId) {
      await transaction.generationRun.updateMany({
        where: {
          versionId: job.versionId,
          stage: job.stage,
          startedAt: { gte: job.queuedAt, lte: failureBoundary },
          status: 'RUNNING',
        },
        data: {
          status: 'FAILED',
          completedAt: failureBoundary,
          error: runError,
        },
      });
    }
    const version = job.versionId
      ? await transaction.generationVersion.findFirst({
          where: {
            id: job.versionId,
            projectId: job.projectId,
            status: GenerationVersionStatus.STAGING,
          },
          select: { currentStage: true, confirmedStage: true },
        })
      : null;
    const stableStage = version?.currentStage ?? version?.confirmedStage ?? 'IDEA';
    await transaction.project.updateMany({
      where: {
        id: job.projectId,
        status: 'GENERATING',
        jobs: { none: { status: { in: activeStatuses } } },
      },
      data: { status: 'REVIEWING', currentStage: stableStage },
    });
  }

  private async shouldDeferTerminalReconciliation(job: GenerationJob) {
    if (job.status !== GenerationJobStatus.RUNNING) return false;
    const latestRun = await this.prisma.generationRun.findFirst({
      where: {
        versionId: job.versionId,
        stage: job.stage,
        startedAt: { gte: job.queuedAt },
      },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true },
    });
    if (latestRun) {
      return (
        latestRun.status === 'RUNNING' &&
        Date.now() - latestRun.startedAt.getTime() < this.inFlightRunReconcileGraceMs
      );
    }
    return Date.now() - job.updatedAt.getTime() < preProviderReconcileGraceMs;
  }

  private boundedInteger(
    config: ConfigService,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const value = Number(config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value) || value < minimum) return fallback;
    return Math.min(value, maximum);
  }

  private toPublicJob(job: {
    id: string;
    projectId: string;
    versionId: string | null;
    stage: string;
    status: GenerationJobStatus;
    progress: number;
    currentStage: string | null;
    message: string;
    safeErrorMessage: string | null;
    attempt: number;
    resultVersionId: string | null;
    queuedAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date;
  }) {
    return {
      id: job.id,
      projectId: job.projectId,
      versionId: job.versionId,
      stage: job.stage,
      status: job.status,
      progress: job.progress,
      currentStage: job.currentStage,
      message: job.message,
      error: job.safeErrorMessage,
      attempt: job.attempt,
      resultVersionId: job.resultVersionId,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      updatedAt: job.updatedAt,
    };
  }

  private stageLabel(stage: StageKey) {
    return {
      PREMISE: '故事内核',
      CHARACTERS: '人物档案',
      LOCATIONS: '场景空间',
      BEATS: '情节节拍',
      SCENES: '分场计划',
      SCRIPT: '完整剧本',
    }[stage];
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('这个项目已经有生成任务在进行中');
    }
    if (isSerializableTransactionConflict(error)) {
      throw new ServiceUnavailableException('并发请求较多，请稍后重试');
    }
    throw error;
  }
}
