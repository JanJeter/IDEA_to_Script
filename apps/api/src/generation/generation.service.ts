import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { GenerationVersionStatus, Prisma, ProjectStatus, RunStatus } from '@prisma/client';
import { PremiseAgentService } from '../agent/premise-agent.service';
import type { StageAgentResult } from '../agent/contracts/stage-agent.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  AbuseProtectionService,
  retrySerializableTransaction,
} from '../security/abuse-protection.service';
import type { AltchaChallenge, AltchaSolution } from '../security/altcha.types';
import { toGenerationDraft } from './generation-draft';
import { NonRetryableGenerationError } from './generation-error';
import { toFountain } from './fountain';
import type {
  BeatResult,
  CharacterRelationshipResult,
  CharacterResult,
  GenerationEvent,
  LocationResult,
  PremiseResult,
  ScenePlanResult,
  StageKey,
  WrittenSceneResult,
} from './generation.types';
import { generationStages, isStageKey } from './generation.types';
import { type LlmCallTelemetry, LlmRequestError, LlmService } from './llm.service';
import {
  mockBeats,
  mockCharacters,
  mockLocations,
  mockPremise,
  mockRelationships,
  mockScenePlans,
  mockWrittenScenes,
} from './mock-generator';
import {
  beatsPrompt,
  charactersPrompt,
  locationsPrompt,
  premisePrompt,
  screenplayPrompt,
  scenesPrompt,
} from './prompts';
import { parseStagePayload } from './stage-schemas';

const generationProjectInclude = {
  characters: { orderBy: { sortOrder: 'asc' as const } },
  relationships: { orderBy: { sortOrder: 'asc' as const } },
  locations: { orderBy: { sortOrder: 'asc' as const } },
  beats: { orderBy: { sequence: 'asc' as const } },
  scenes: {
    orderBy: { sceneNumber: 'asc' as const },
    include: { beat: { select: { sequence: true } } },
  },
} satisfies Prisma.ProjectInclude;

const stageDetails: Record<StageKey, { start: number; end: number; message: string }> = {
  PREMISE: { start: 5, end: 16, message: '扩展故事前提与主题' },
  CHARACTERS: { start: 18, end: 31, message: '塑造人物目标、矛盾与声音' },
  LOCATIONS: { start: 33, end: 44, message: '建立可拍摄的地点与视觉母题' },
  BEATS: { start: 46, end: 60, message: '构建三幕式情节节拍' },
  SCENES: { start: 62, end: 75, message: '把节拍拆成可执行场景' },
  SCRIPT: { start: 77, end: 96, message: '撰写动作、对白与潜台词' },
};

type GenerationProject = Prisma.ProjectGetPayload<{ include: typeof generationProjectInclude }>;
type WorkflowVersion = Prisma.GenerationVersionGetPayload<Record<string, never>>;
type StageGenerationResult = {
  update: Prisma.GenerationVersionUpdateInput;
  telemetry?: StageAgentResult;
};
export type GenerationEventSink = (
  transaction: Prisma.TransactionClient,
  event: GenerationEvent,
) => Promise<void>;
export type StageCompletion = (
  transaction: Prisma.TransactionClient,
  versionId: string,
  stage: StageKey,
  event: GenerationEvent,
) => Promise<void>;

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly abuseProtection: AbuseProtectionService,
    @Optional() private readonly premiseAgent?: PremiseAgentService,
  ) {}

  createChallenge(projectId: string, visitorId: string, clientIp: string) {
    return this.abuseProtection.createChallenge(projectId, visitorId, clientIp);
  }

  authorize(
    projectId: string,
    visitorId: string,
    clientIp: string,
    challenge: AltchaChallenge,
    solution: AltchaSolution,
  ) {
    return this.abuseProtection.authorizeGeneration(
      projectId,
      visitorId,
      clientIp,
      challenge,
      solution,
      !this.llm.isDemo,
    );
  }

  async prepareDraft(
    transaction: Prisma.TransactionClient,
    projectId: string,
    visitorId: string,
  ) {
    const project = await transaction.project.findFirst({
      where: { id: projectId, visitorId, expiresAt: { gt: new Date() } },
      include: generationProjectInclude,
    });
    if (!project) throw new NotFoundException('项目不存在或已过期');

    const existingDraft = await transaction.generationVersion.findFirst({
      where: { projectId, status: GenerationVersionStatus.STAGING },
      select: { id: true },
    });
    if (existingDraft) throw new ConflictException('这个项目已有待确认的阶段草稿');

    if (this.hasCurrentContent(project) && !project.activeVersionId) {
      const captured = await this.captureCurrentVersion(transaction, project);
      await transaction.project.update({
        where: { id: projectId },
        data: { activeVersionId: captured.id },
      });
    }

    const version = await transaction.generationVersion.create({
      data: {
        projectId,
        status: GenerationVersionStatus.STAGING,
        currentStage: 'IDEA',
      },
    });
    await transaction.project.update({
      where: { id: projectId },
      data: { status: ProjectStatus.GENERATING, currentStage: 'PREMISE' },
    });
    return version;
  }

  async executeStage(
    projectId: string,
    visitorId: string,
    jobId: string,
    versionId: string,
    stage: StageKey,
    emit: GenerationEventSink,
    onCompleted: StageCompletion,
    expectedAttempt: number,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, visitorId, expiresAt: { gt: new Date() } },
    });
    if (!project) throw new NotFoundException('项目不存在或已过期');
    const version = await this.prisma.generationVersion.findFirst({
      where: { id: versionId, projectId, status: GenerationVersionStatus.STAGING },
    });
    if (!version) throw new NotFoundException('阶段草稿不存在');
    this.assertStageCanRun(version, stage);

    const details = stageDetails[stage];
    const previousStage = version.currentStage;
    let runId: string | undefined;
    const providerCalls: LlmCallTelemetry[] = [];

    try {
      // Lock the business Job row, verify this worker still owns the exact
      // pg-boss attempt, and commit all pre-provider writes with the Run. If any
      // write fails there is no Run and retry is safe. Once the transaction
      // commits, a newer attempt observes the Run and stops before provider I/O.
      const run = await this.prisma.$transaction(async (transaction) => {
        const ownsAttempt = await transaction.generationJob.updateMany({
          where: {
            id: jobId,
            status: 'RUNNING',
            attempt: expectedAttempt,
          },
          data: { attempt: expectedAttempt },
        });
        if (ownsAttempt.count !== 1) return null;

        await transaction.project.update({
          where: { id: projectId },
          data: { status: ProjectStatus.GENERATING, currentStage: stage },
        });
        await emit(transaction, {
          type: 'stage:start',
          stage,
          message: details.message,
          progress: details.start,
          projectId,
        });
        return transaction.generationRun.create({
          data: { projectId, versionId, stage, status: RunStatus.RUNNING, model: this.llm.model },
        });
      });
      if (!run) return;
      runId = run.id;

      let generated: StageGenerationResult;
      try {
        generated = await this.generateStage(project, version, stage, {
          runId: run.id,
          jobId,
          visitorId,
          onLlmCall: (call) => providerCalls.push(call),
        });
        this.validateGeneratedStage(stage, generated.update);
      } catch (error) {
        // Output-shape conflicts cannot be repaired by replaying the same paid
        // stage automatically. User-edit conflicts are outside executeStage and
        // keep their original HTTP 409 behavior.
        if (error instanceof LlmRequestError || error instanceof NonRetryableGenerationError) {
          throw error;
        }
        const message =
          error instanceof ConflictException ? error.message : '模型返回内容不符合当前阶段的数据契约';
        throw new NonRetryableGenerationError(message, 'invalid_output', error);
      }
      const completionEvent: GenerationEvent = {
        type: 'stage:complete',
        stage,
        message: `${details.message} · 完成，等待确认`,
        progress: details.end,
        projectId,
      };
      try {
        // The provider call has already completed. Retry only the idempotent DB
        // transaction so a serialization abort never replays the paid request.
        const completedByCurrentAttempt = await retrySerializableTransaction(
          () =>
            this.prisma.$transaction(
              async (transaction) => {
                const ownsAttempt = await transaction.generationJob.updateMany({
                  where: {
                    id: jobId,
                    status: 'RUNNING',
                    attempt: expectedAttempt,
                  },
                  data: { attempt: expectedAttempt },
                });
                if (ownsAttempt.count !== 1) {
                  // The paid request already happened, so retain its cost
                  // telemetry on this attempt's Run without touching shared
                  // draft/project/Job state owned by a newer attempt.
                  await transaction.generationRun.update({
                    where: { id: run.id },
                    data: this.runTelemetry(generated.telemetry, providerCalls),
                  });
                  return false;
                }
                await transaction.generationVersion.update({
                  where: { id: versionId },
                  data: { ...generated.update, currentStage: stage, error: null },
                });
                await transaction.generationRun.update({
                  where: { id: run.id },
                  data: {
                    status: RunStatus.COMPLETED,
                    completedAt: new Date(),
                    ...this.runTelemetry(generated.telemetry, providerCalls),
                  },
                });
                await transaction.project.update({
                  where: { id: projectId },
                  data: { status: ProjectStatus.REVIEWING, currentStage: stage },
                });
                await onCompleted(transaction, versionId, stage, completionEvent);
                return true;
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            ),
          { exhaustedMessage: '生成结果保存发生并发冲突，请稍后手动重试' },
        );
        if (!completedByCurrentAttempt) return;
      } catch (error) {
        // Trend-risk changes deliberately use a ConflictException and must keep
        // their dedicated worker handling. Every other post-provider failure is
        // non-retryable at the job layer to avoid another paid model call.
        if (error instanceof ConflictException) throw error;
        throw new NonRetryableGenerationError(
          '模型输出已生成，但结果保存失败；为避免重复计费，系统未自动重新调用模型',
          'result_persistence',
          error,
        );
      }
    } catch (error) {
      try {
        await this.prisma.$transaction(async (transaction) => {
          const stillOwnsAttempt = await transaction.generationJob.updateMany({
            where: {
              id: jobId,
              status: 'RUNNING',
              attempt: expectedAttempt,
            },
            data: { attempt: expectedAttempt },
          });
          // A newer retry, stopPrevious, or a completion whose commit response
          // was lost now owns the shared state. Never roll it backward.
          if (stillOwnsAttempt.count !== 1) return;
          if (runId) {
            const failedRun = await transaction.generationRun.updateMany({
              where: { id: runId, status: RunStatus.RUNNING },
              data: {
                status: RunStatus.FAILED,
                completedAt: new Date(),
                error: error instanceof Error ? error.message : String(error),
                ...this.runScalarTelemetry(undefined, providerCalls),
              },
            });
            if (failedRun.count === 1 && providerCalls.length > 0) {
              await transaction.generationProviderCall.createMany({
                data: this.providerCallRows(runId, providerCalls),
                skipDuplicates: true,
              });
            }
          }
          await transaction.project.update({
            where: { id: projectId },
            data: { status: ProjectStatus.REVIEWING, currentStage: previousStage },
          });
        });
      } catch (cleanupError) {
        this.logger.error(
          `Generation cleanup failed for job ${jobId}`,
          cleanupError instanceof Error ? cleanupError.stack : String(cleanupError),
        );
        // Preserve the original generation failure. A later queue/business-state
        // reconciliation can repair status without replaying a paid request.
      }
      throw error;
    }
  }

  async updateStage(
    projectId: string,
    visitorId: string,
    rawStage: string,
    content: Record<string, unknown>,
  ) {
    const stage = this.parseStage(rawStage);
    const operation = async (transaction: Prisma.TransactionClient) => {
      const version = await transaction.generationVersion.findFirst({
        where: {
          projectId,
          status: GenerationVersionStatus.STAGING,
          project: { visitorId, expiresAt: { gt: new Date() } },
        },
      });
      if (!version) throw new NotFoundException('阶段草稿不存在或已过期');
      if (version.currentStage !== stage || version.confirmedStage === stage) {
        throw new ConflictException('只能编辑当前等待确认的阶段');
      }
      const activeJob = await transaction.generationJob.findFirst({
        where: { projectId, status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } },
        select: { id: true },
      });
      if (activeJob) throw new ConflictException('阶段生成期间不能保存修改');
      const data = this.validateStageUpdate(stage, content, version);
      if (typeof transaction.generationVersion.updateMany !== 'function') {
        return transaction.generationVersion.update({ where: { id: version.id }, data });
      }
      const result = await transaction.generationVersion.updateMany({
        where: {
          id: version.id,
          status: GenerationVersionStatus.STAGING,
          currentStage: stage,
          OR: [{ confirmedStage: null }, { confirmedStage: { not: stage } }],
        },
        data,
      });
      if (result.count !== 1) throw new ConflictException('阶段已确认或正在生成，请刷新后重试');
      return transaction.generationVersion.findUniqueOrThrow({ where: { id: version.id } });
    };
    const runTransaction = this.abuseProtection.runSerializableTransaction;
    const updated = typeof runTransaction === 'function'
      ? await runTransaction.call(this.abuseProtection, operation, '保存阶段时发生并发冲突，请稍后重试')
      : await operation(this.prisma as unknown as Prisma.TransactionClient);
    return { draft: toGenerationDraft(updated as WorkflowVersion) };
  }

  async activateDraft(
    transaction: Prisma.TransactionClient,
    projectId: string,
    visitorId: string,
    versionId: string,
  ) {
    const project = await transaction.project.findFirst({
      where: { id: projectId, visitorId, expiresAt: { gt: new Date() } },
      include: generationProjectInclude,
    });
    const version = await transaction.generationVersion.findFirst({
      where: { id: versionId, projectId, status: GenerationVersionStatus.STAGING },
    });
    if (!project || !version) throw new NotFoundException('阶段草稿不存在或已过期');
    if (version.currentStage !== 'SCRIPT') throw new ConflictException('完整剧本尚未生成');

    const premise = this.versionPremise(version);
    const characters = this.sanitizeCharacters(version.characters);
    const relationships = this.sanitizeRelationships(version.relationships, characters.length);
    const locations = this.versionArray<LocationResult>(version.locations, 'locations');
    const beats = this.versionArray<BeatResult>(version.beats, 'beats');
    const scenePlans = this.versionArray<ScenePlanResult>(version.scenePlans, 'scenePlans');
    const writtenScenes = this.versionArray<WrittenSceneResult>(version.writtenScenes, 'writtenScenes');
    const scenes = this.mergeScenes(scenePlans, writtenScenes);
    const scriptText = version.scriptText ?? toFountain({ title: premise.title, genre: project.genre, scenes });

    await transaction.scene.deleteMany({ where: { projectId } });
    await transaction.beat.deleteMany({ where: { projectId } });
    await transaction.characterRelationship.deleteMany({ where: { projectId } });
    await transaction.character.deleteMany({ where: { projectId } });
    await transaction.location.deleteMany({ where: { projectId } });
    await transaction.character.createMany({
      data: characters.map((character, sortOrder) => ({ ...character, projectId, sortOrder })),
    });
    const storedCharacters = await transaction.character.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    });
    const characterIds = new Map(storedCharacters.map((character) => [character.sortOrder, character.id]));
    if (relationships.length > 0) {
      await transaction.characterRelationship.createMany({
        data: relationships.map((relationship, sortOrder) => ({
          projectId,
          sourceId: characterIds.get(relationship.sourceIndex)!,
          targetId: characterIds.get(relationship.targetIndex)!,
          type: relationship.type,
          description: relationship.description,
          strength: relationship.strength,
          directed: relationship.directed,
          sortOrder,
        })),
      });
    }
    await transaction.location.createMany({
      data: locations.map((location, sortOrder) => ({ ...location, projectId, sortOrder })),
    });
    await transaction.beat.createMany({
      data: beats.map((beat) => ({ ...beat, projectId })),
    });
    const storedBeats = await transaction.beat.findMany({ where: { projectId } });
    const beatIds = new Map(storedBeats.map((beat) => [beat.sequence, beat.id]));
    await transaction.scene.createMany({
      data: scenes.map((scene) => ({
        projectId,
        beatId: beatIds.get(scene.beatSequence),
        sceneNumber: scene.sceneNumber,
        heading: scene.heading,
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        summary: scene.summary,
        action: scene.action,
        dialogue: this.toJson(scene.dialogue),
        estimatedSeconds: scene.estimatedSeconds,
      })),
    });

    if (project.activeVersionId && project.activeVersionId !== versionId) {
      await transaction.generationVersion.updateMany({
        where: { id: project.activeVersionId, status: GenerationVersionStatus.ACTIVE },
        data: { status: GenerationVersionStatus.SUPERSEDED },
      });
    }
    await transaction.generationVersion.update({
      where: { id: versionId },
      data: {
        status: GenerationVersionStatus.ACTIVE,
        confirmedStage: 'SCRIPT',
        completedAt: new Date(),
      },
    });
    await transaction.project.update({
      where: { id: projectId },
      data: {
        activeVersionId: versionId,
        title: premise.title,
        premise: premise.premise,
        synopsis: premise.synopsis,
        theme: premise.theme,
        scriptText,
        status: ProjectStatus.READY,
        currentStage: 'COMPLETE',
      },
    });
  }

  parseStage(value: string): StageKey {
    const normalized = value.toUpperCase();
    if (!isStageKey(normalized)) throw new NotFoundException('生成阶段不存在');
    return normalized;
  }

  private async generateStage(
    project: Prisma.ProjectGetPayload<Record<string, never>>,
    version: WorkflowVersion,
    stage: StageKey,
    execution: {
      runId: string;
      jobId: string;
      visitorId: string;
      onLlmCall: (call: LlmCallTelemetry) => void;
    },
  ): Promise<StageGenerationResult> {
    switch (stage) {
      case 'PREMISE': {
        if (this.premiseAgent?.enabled) {
          const generated = await this.premiseAgent.generate({
            project,
            runId: execution.runId,
            jobId: execution.jobId,
            versionId: version.id,
            visitorId: execution.visitorId,
          });
          return {
            update: {
              title: generated.draft.title,
              premise: generated.draft.premise,
              synopsis: generated.draft.synopsis,
              theme: generated.draft.theme,
            },
            telemetry: generated.telemetry,
          };
        }
        const result = await this.llm.generateJson<PremiseResult>(
          premisePrompt(project),
          () => mockPremise(project),
          { onCall: execution.onLlmCall },
        );
        this.requireFields(result, ['title', 'premise', 'synopsis', 'theme']);
        return {
          update: {
            title: result.title,
            premise: result.premise,
            synopsis: result.synopsis,
            theme: result.theme,
          },
        };
      }
      case 'CHARACTERS': {
        const premise = this.versionPremise(version);
        const result = await this.llm.generateJson<{
          characters: CharacterResult[];
          relationships: CharacterRelationshipResult[];
        }>(
          charactersPrompt(project, premise.premise),
          () => ({ characters: mockCharacters(), relationships: mockRelationships() }),
          { onCall: execution.onLlmCall },
        );
        const characters = this.sanitizeCharacters(result.characters);
        const relationships = this.sanitizeRelationships(result.relationships, characters.length);
        if (relationships.length < 2 || relationships.length > 6) {
          throw new ConflictException('人物关系必须包含 2–6 条有效关系');
        }
        return {
          update: {
            characters: this.toJson(characters),
            relationships: this.toJson(relationships),
          },
        };
      }
      case 'LOCATIONS': {
        const premise = this.versionPremise(version);
        const characters = this.versionArray<CharacterResult>(version.characters, 'characters');
        const result = await this.llm.generateJson<{ locations: LocationResult[] }>(
          locationsPrompt(project, premise.synopsis, characters),
          () => ({ locations: mockLocations() }),
          { onCall: execution.onLlmCall },
        );
        return {
          update: { locations: this.toJson(this.requireArray(result.locations, 'locations')) },
        };
      }
      case 'BEATS': {
        const premise = this.versionPremise(version);
        const characters = this.versionArray<CharacterResult>(version.characters, 'characters');
        const locations = this.versionArray<LocationResult>(version.locations, 'locations');
        const result = await this.llm.generateJson<{ beats: BeatResult[] }>(
          beatsPrompt(project, premise.synopsis, characters, locations),
          () => ({ beats: mockBeats(project) }),
          { onCall: execution.onLlmCall },
        );
        const beats = this.requireArray(result.beats, 'beats').map((beat, index) => ({
          ...beat,
          act: Math.min(3, Math.max(1, Number(beat.act) || 1)),
          sequence: index + 1,
        }));
        return { update: { beats: this.toJson(beats) } };
      }
      case 'SCENES': {
        const beats = this.versionArray<BeatResult>(version.beats, 'beats');
        const locations = this.versionArray<LocationResult>(version.locations, 'locations');
        const result = await this.llm.generateJson<{ scenes: ScenePlanResult[] }>(
          scenesPrompt(project, beats, locations),
          () => ({ scenes: mockScenePlans(project, beats) }),
          { onCall: execution.onLlmCall },
        );
        const scenes = this.requireArray(result.scenes, 'scenes').map((scene, index) => ({
          ...scene,
          sceneNumber: index + 1,
          beatSequence: Math.min(beats.length, Math.max(1, Number(scene.beatSequence) || 1)),
          estimatedSeconds: Math.max(15, Number(scene.estimatedSeconds) || 60),
        }));
        return { update: { scenePlans: this.toJson(scenes) } };
      }
      case 'SCRIPT': {
        const premise = this.versionPremise(version);
        const characters = this.versionArray<CharacterResult>(version.characters, 'characters');
        const scenePlans = this.versionArray<ScenePlanResult>(version.scenePlans, 'scenePlans');
        const result = await this.llm.generateJson<{ scenes: WrittenSceneResult[] }>(
          screenplayPrompt(project, characters, scenePlans),
          () => ({ scenes: mockWrittenScenes(scenePlans, characters) }),
          { onCall: execution.onLlmCall },
        );
        const writtenScenes = this.requireArray(result.scenes, 'scenes');
        const scriptText = toFountain({
          title: premise.title,
          genre: project.genre,
          scenes: this.mergeScenes(scenePlans, writtenScenes),
        });
        return { update: { writtenScenes: this.toJson(writtenScenes), scriptText } };
      }
    }
  }

  private runTelemetry(agent: StageAgentResult | undefined, calls: LlmCallTelemetry[]) {
    return {
      ...this.runScalarTelemetry(agent, calls),
      providerCalls: calls.length
        ? {
            create: this.providerCallData(calls),
          }
        : undefined,
    };
  }

  private runScalarTelemetry(agent: StageAgentResult | undefined, calls: LlmCallTelemetry[]) {
    const promptTokens = agent?.promptTokens ?? this.completeTokenTotal(calls, 'promptTokens');
    const completionTokens =
      agent?.completionTokens ?? this.completeTokenTotal(calls, 'completionTokens');
    return {
      providerCallCount: agent?.steps ?? calls.length,
      providerDurationMs: calls.length
        ? calls.reduce((total, call) => total + call.durationMs, 0)
        : null,
      promptTokens,
      completionTokens,
    };
  }

  private providerCallData(calls: LlmCallTelemetry[]) {
    return calls.map((call) => ({
      sequence: call.sequence,
      structured: call.structured,
      outcome: call.outcome,
      retryable: call.retryable,
      httpStatus: call.httpStatus,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      durationMs: call.durationMs,
    }));
  }

  private providerCallRows(runId: string, calls: LlmCallTelemetry[]) {
    return this.providerCallData(calls).map((call) => ({ runId, ...call }));
  }

  private completeTokenTotal(
    calls: LlmCallTelemetry[],
    field: 'promptTokens' | 'completionTokens',
  ) {
    if (calls.length === 0 || calls.some((call) => call[field] === null)) return null;
    return calls.reduce((total, call) => total + (call[field] ?? 0), 0);
  }

  private validateStageUpdate(
    stage: StageKey,
    content: Record<string, unknown>,
    version: WorkflowVersion,
  ): Prisma.GenerationVersionUpdateInput {
    switch (stage) {
      case 'PREMISE': {
        const result = content as PremiseResult;
        this.requireFields(result, ['title', 'premise', 'synopsis', 'theme']);
        return {
          title: this.requiredText(result.title, 'title'),
          premise: this.requiredText(result.premise, 'premise'),
          synopsis: this.requiredText(result.synopsis, 'synopsis'),
          theme: this.requiredText(result.theme, 'theme'),
        };
      }
      case 'CHARACTERS': {
        const characters = this.sanitizeCharacters(content.characters);
        const relationshipsProvided = Object.prototype.hasOwnProperty.call(content, 'relationships');
        let relationships: CharacterRelationshipResult[];
        if (!relationshipsProvided) {
          const previousCharacters = this.sanitizeCharacters(version.characters);
          const existingRelationships = this.sanitizeRelationships(
            version.relationships,
            previousCharacters.length,
          );
          const identityChanged = previousCharacters.length !== characters.length
            || previousCharacters.some((character, index) => character.name !== characters[index]?.name);
          const ambiguousDuplicateNames = existingRelationships.length > 0
            && (this.hasDuplicateCharacterNames(previousCharacters)
              || this.hasDuplicateCharacterNames(characters));
          if (identityChanged || ambiguousDuplicateNames) {
            throw new ConflictException('修改人物姓名、数量或顺序时必须同时提交 relationships');
          }
          relationships = existingRelationships;
        } else {
          relationships = this.sanitizeRelationships(content.relationships, characters.length);
        }
        return {
          characters: this.toJson(characters),
          relationships: this.toJson(relationships),
        };
      }
      case 'LOCATIONS':
        parseStagePayload('LOCATIONS', { locations: content.locations });
        return { locations: this.toJson(content.locations as LocationResult[]) };
      case 'BEATS': {
        parseStagePayload('BEATS', { beats: content.beats });
        const beats = this.requireArray(content.beats as BeatResult[], 'beats').map((beat, index) => ({
          ...beat,
          act: Math.min(3, Math.max(1, Number(beat.act) || 1)),
          sequence: index + 1,
        }));
        return { beats: this.toJson(beats) };
      }
      case 'SCENES': {
        parseStagePayload('SCENES', { scenes: content.scenes });
        const scenes = this.requireArray(content.scenes as ScenePlanResult[], 'scenes').map(
          (scene, index) => ({
            ...scene,
            sceneNumber: index + 1,
            beatSequence: Math.max(1, Number(scene.beatSequence) || 1),
            estimatedSeconds: Math.max(15, Number(scene.estimatedSeconds) || 60),
          }),
        );
        return { scenePlans: this.toJson(scenes) };
      }
      case 'SCRIPT': {
        const scriptText = this.requiredText(content.scriptText, 'scriptText');
        if (!version.writtenScenes) throw new ConflictException('剧本场景数据不存在');
        parseStagePayload('SCRIPT', { writtenScenes: version.writtenScenes, scriptText });
        return { scriptText };
      }
    }
  }

  private validateGeneratedStage(stage: StageKey, update: Prisma.GenerationVersionUpdateInput) {
    const value = update as Record<string, unknown>;
    if (stage === 'PREMISE') parseStagePayload(stage, value);
    if (stage === 'CHARACTERS') parseStagePayload(stage, { characters: value.characters, relationships: value.relationships });
    if (stage === 'LOCATIONS') parseStagePayload(stage, { locations: value.locations });
    if (stage === 'BEATS') parseStagePayload(stage, { beats: value.beats });
    if (stage === 'SCENES') parseStagePayload(stage, { scenes: value.scenePlans });
    if (stage === 'SCRIPT') parseStagePayload(stage, { writtenScenes: value.writtenScenes, scriptText: value.scriptText });
  }

  private assertStageCanRun(version: WorkflowVersion, stage: StageKey) {
    const stageIndex = generationStages.indexOf(stage);
    const previousStage = generationStages[stageIndex - 1];
    const regeneratingCurrent = version.currentStage === stage && version.confirmedStage !== stage;
    const generatingNext = previousStage
      ? version.currentStage === previousStage && version.confirmedStage === previousStage
      : version.currentStage === 'IDEA';
    if (!regeneratingCurrent && !generatingNext) {
      throw new ConflictException('请先确认上一阶段');
    }
  }

  private hasCurrentContent(project: GenerationProject) {
    return Boolean(
      project.premise ||
        project.synopsis ||
        project.theme ||
        project.scriptText ||
        project.characters.length ||
        project.relationships.length ||
        project.locations.length ||
        project.beats.length ||
        project.scenes.length,
    );
  }

  private captureCurrentVersion(transaction: Prisma.TransactionClient, project: GenerationProject) {
    const characterIndexes = new Map(project.characters.map((character, index) => [character.id, index]));
    const relationships = project.relationships.flatMap((relationship) => {
      const sourceIndex = characterIndexes.get(relationship.sourceId);
      const targetIndex = characterIndexes.get(relationship.targetId);
      if (sourceIndex === undefined || targetIndex === undefined) return [];
      return [{
        sourceIndex,
        targetIndex,
        type: relationship.type,
        description: relationship.description,
        strength: relationship.strength,
        directed: relationship.directed,
      }];
    });
    return transaction.generationVersion.create({
      data: {
        projectId: project.id,
        status: GenerationVersionStatus.ACTIVE,
        title: project.title,
        premise: project.premise,
        synopsis: project.synopsis,
        theme: project.theme,
        characters: this.toJson(
          project.characters.map(({ name, role, age, description, goal, conflict, arc, voice }) => ({
            name,
            role,
            age,
            description,
            goal,
            conflict,
            arc,
            voice,
          })),
        ),
        relationships: this.toJson(
          this.sanitizeRelationships(relationships, project.characters.length),
        ),
        locations: this.toJson(
          project.locations.map(({ name, description, atmosphere, recurringElements }) => ({
            name,
            description,
            atmosphere,
            recurringElements,
          })),
        ),
        beats: this.toJson(
          project.beats.map(({ act, sequence, title, summary, emotionalShift }) => ({
            act,
            sequence,
            title,
            summary,
            emotionalShift,
          })),
        ),
        scenePlans: this.toJson(
          project.scenes.map(
            ({ sceneNumber, heading, location, timeOfDay, summary, estimatedSeconds, beat }) => ({
              sceneNumber,
              beatSequence: beat?.sequence ?? 1,
              heading,
              location,
              timeOfDay,
              summary,
              estimatedSeconds,
            }),
          ),
        ),
        writtenScenes: this.toJson(
          project.scenes.map(({ sceneNumber, action, dialogue }) => ({
            sceneNumber,
            action,
            dialogue,
          })),
        ),
        scriptText: project.scriptText,
        currentStage: 'SCRIPT',
        confirmedStage: 'SCRIPT',
        completedAt: new Date(),
      },
    });
  }

  private versionPremise(version: WorkflowVersion): PremiseResult {
    const result = {
      title: version.title ?? '',
      premise: version.premise ?? '',
      synopsis: version.synopsis ?? '',
      theme: version.theme ?? '',
    };
    this.requireFields(result, ['title', 'premise', 'synopsis', 'theme']);
    return result;
  }

  private versionArray<T>(value: Prisma.JsonValue | null, field: string): T[] {
    return this.requireArray(value as T[] | undefined, field);
  }

  private mergeScenes(scenePlans: ScenePlanResult[], writtenScenes: WrittenSceneResult[]) {
    const writtenByNumber = new Map(writtenScenes.map((scene) => [Number(scene.sceneNumber), scene]));
    return scenePlans.map((scene) => {
      const written = writtenByNumber.get(scene.sceneNumber);
      return {
        ...scene,
        action: written?.action ?? scene.summary,
        dialogue: written?.dialogue ?? [],
      };
    });
  }

  private sanitizeRelationships(
    value: unknown,
    characterCount: number,
  ): CharacterRelationshipResult[] {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) throw new ConflictException('relationships 必须是数组');

    const seen = new Set<string>();
    const sanitized: CharacterRelationshipResult[] = [];
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object') continue;
      const relationship = candidate as Record<string, unknown>;
      const sourceIndex = relationship.sourceIndex;
      const targetIndex = relationship.targetIndex;
      if (
        !Number.isInteger(sourceIndex) ||
        !Number.isInteger(targetIndex) ||
        (sourceIndex as number) < 0 ||
        (targetIndex as number) < 0 ||
        (sourceIndex as number) >= characterCount ||
        (targetIndex as number) >= characterCount ||
        sourceIndex === targetIndex
      ) {
        continue;
      }

      const type = typeof relationship.type === 'string' ? relationship.type.trim() : '';
      const description =
        typeof relationship.description === 'string' ? relationship.description.trim() : '';
      if (!type || !description) continue;

      const directed = relationship.directed === true;
      const rawStrength = Number(relationship.strength);
      const strength = Number.isFinite(rawStrength)
        ? Math.min(5, Math.max(1, Math.round(rawStrength)))
        : 3;
      let normalizedSource = sourceIndex as number;
      let normalizedTarget = targetIndex as number;
      if (!directed && normalizedSource > normalizedTarget) {
        [normalizedSource, normalizedTarget] = [normalizedTarget, normalizedSource];
      }
      const key = `${directed ? 'directed' : 'undirected'}:${normalizedSource}:${normalizedTarget}:${type.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sanitized.push({
        sourceIndex: normalizedSource,
        targetIndex: normalizedTarget,
        type,
        description,
        strength,
        directed,
      });
    }
    return sanitized;
  }

  private sanitizeCharacters(value: unknown): CharacterResult[] {
    const characters = this.requireArray(value as CharacterResult[] | undefined, 'characters');
    return characters.map((candidate, index) => {
      if (!candidate || typeof candidate !== 'object') {
        throw new ConflictException(`人物 ${index + 1} 格式无效`);
      }
      const character = candidate as unknown as Record<string, unknown>;
      const name = this.requiredText(character.name, `characters[${index}].name`);
      const role = this.requiredText(character.role, `characters[${index}].role`);
      const description = this.requiredText(character.description, `characters[${index}].description`);
      const goal = this.requiredText(character.goal, `characters[${index}].goal`);
      const conflict = this.requiredText(character.conflict, `characters[${index}].conflict`);
      const arc = this.requiredText(character.arc, `characters[${index}].arc`);
      const voice = this.requiredText(character.voice, `characters[${index}].voice`);
      const age = typeof character.age === 'string' && character.age.trim()
        ? character.age.trim()
        : undefined;
      return { name, role, age, description, goal, conflict, arc, voice };
    });
  }

  private hasDuplicateCharacterNames(characters: CharacterResult[]) {
    const names = new Set<string>();
    return characters.some((character) => {
      const name = character.name.toLocaleLowerCase();
      if (names.has(name)) return true;
      names.add(name);
      return false;
    });
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private requireArray<T>(value: T[] | undefined, field: string): T[] {
    if (!Array.isArray(value) || value.length === 0) throw new ConflictException(`阶段内容缺少 ${field}`);
    return value;
  }

  private requireFields<T extends object>(value: T, fields: Array<keyof T>) {
    for (const field of fields) {
      if (!value[field]) throw new ConflictException(`阶段内容缺少字段 ${String(field)}`);
    }
  }

  private requiredText(value: unknown, field: string) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ConflictException(`阶段内容缺少字段 ${field}`);
    }
    return value.trim();
  }
}
