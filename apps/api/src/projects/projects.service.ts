import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GenerationJobStatus, Prisma, ProjectMode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AbuseProtectionService } from '../security/abuse-protection.service';
import { toGenerationDraft } from '../generation/generation-draft';
import { TrendBriefService } from '../trends/trend-brief.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';

const projectInclude = {
  characters: { orderBy: { sortOrder: 'asc' as const } },
  relationships: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      source: { select: { id: true, name: true, sortOrder: true } },
      target: { select: { id: true, name: true, sortOrder: true } },
    },
  },
  locations: { orderBy: { sortOrder: 'asc' as const } },
  beats: { orderBy: { sequence: 'asc' as const } },
  scenes: { orderBy: { sceneNumber: 'asc' as const } },
  runs: { orderBy: { startedAt: 'desc' as const }, take: 20 },
  versions: {
    where: { status: 'STAGING' as const },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
  trendTopic: {
    select: {
      id: true,
      title: true,
      sourceLabel: true,
      sourceUrl: true,
      riskLevel: true,
    },
  },
};

const activeGenerationJobStatuses: GenerationJobStatus[] = [
  GenerationJobStatus.QUEUED,
  GenerationJobStatus.RUNNING,
  GenerationJobStatus.RETRYING,
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly abuseProtection: AbuseProtectionService,
    private readonly trendBriefs: TrendBriefService,
  ) {}

  list(visitorId: string) {
    return this.prisma.project.findMany({
      where: { visitorId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        mode: true,
        trendTopicId: true,
        title: true,
        logline: true,
        genre: true,
        tone: true,
        targetMinutes: true,
        status: true,
        currentStage: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { scenes: true, characters: true } },
      },
    });
  }

  async get(visitorId: string, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, visitorId, expiresAt: { gt: new Date() } },
      include: projectInclude,
    });
    if (!project) throw new NotFoundException('项目不存在或已过期');
    return this.presentProject(project);
  }

  async create(visitorId: string, clientIp: string, input: CreateProjectDto) {
    if (input.trendTopicId && input.mode !== ProjectMode.TREND_INSPIRED) {
      throw new BadRequestException('trendTopicId 只适用于 TREND_INSPIRED 项目');
    }
    return this.abuseProtection.createOwnedProject(visitorId, clientIp, async (transaction) => {
      let projectInput = input;
      if (input.mode === ProjectMode.TREND_INSPIRED) {
        const topicId = this.requiredTrendTopicId(input);
        const topic = await transaction.trendTopic.findUnique({ where: { id: topicId } });
        if (!topic) throw new NotFoundException('热点信号不存在');
        const canonical = this.trendBriefs.build(topic);
        if (canonical.topic.riskLevel !== 'LOW') {
          throw new BadRequestException('该热点需要人工审核；当前版本不允许建立或生成短剧项目');
        }
        projectInput = {
          ...input,
          mode: ProjectMode.TREND_INSPIRED,
          trendTopicId: canonical.projectInput.trendTopicId,
          // Preserve human edits to creative fields, but never accept a client-edited safety envelope.
          sourceText: canonical.brief.prompt,
        };
      }
      return transaction.project.create({
        data: {
          visitorId,
          mode: projectInput.mode,
          trendTopicId: projectInput.trendTopicId,
          title: projectInput.title,
          logline: projectInput.logline,
          sourceText: projectInput.sourceText,
          genre: projectInput.genre,
          tone: projectInput.tone,
          language: projectInput.language ?? 'zh-CN',
          targetMinutes: projectInput.targetMinutes ?? 8,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
        include: projectInclude,
      }).then((project) => this.presentProject(project));
    });
  }

  async update(visitorId: string, id: string, input: UpdateProjectDto) {
    await this.get(visitorId, id);
    const project = await this.prisma.project.update({
      where: { id },
      data: input,
      include: projectInclude,
    });
    return this.presentProject(project);
  }

  async updateScene(visitorId: string, projectId: string, sceneId: string, input: UpdateSceneDto) {
    const scene = await this.prisma.scene.findFirst({
      where: {
        id: sceneId,
        projectId,
        project: { visitorId, expiresAt: { gt: new Date() } },
      },
    });
    if (!scene) throw new NotFoundException('Scene not found');

    const data: Prisma.SceneUpdateInput = {
      heading: input.heading,
      summary: input.summary,
      action: input.action,
      dialogue: input.dialogue as unknown as Prisma.InputJsonValue | undefined,
    };
    return this.prisma.scene.update({ where: { id: sceneId }, data });
  }

  async remove(visitorId: string, id: string) {
    return this.abuseProtection.runSerializableTransaction(async (transaction) => {
      const project = await transaction.project.findFirst({
        where: { id, visitorId, expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('项目不存在或已过期');

      const activeJob = await transaction.generationJob.findFirst({
        where: { projectId: id, status: { in: activeGenerationJobStatuses } },
        select: { id: true },
      });
      if (activeJob) {
        throw new ConflictException('生成任务进行中，完成或失败后才能删除项目');
      }

      await transaction.project.delete({ where: { id } });
      return { deleted: true };
    }, '删除项目冲突，请稍后重试');
  }

  private presentProject<
    ProjectWithVersions extends { versions: Array<Parameters<typeof toGenerationDraft>[0]> },
  >(project: ProjectWithVersions) {
    const { versions, ...visible } = project;
    return { ...visible, draft: toGenerationDraft(versions[0]) };
  }

  private requiredTrendTopicId(input: CreateProjectDto) {
    if (!input.trendTopicId) throw new BadRequestException('TREND_INSPIRED 项目缺少 trendTopicId');
    return input.trendTopicId;
  }
}
