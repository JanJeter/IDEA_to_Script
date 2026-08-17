import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { GenerationJobStatus, ProjectMode } from '@prisma/client';
import { ProjectsService } from './projects.service';

describe('ProjectsService ownership', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const findFirst = jest.fn();
  const prisma = { project: { findMany, findFirst } };
  const service = new ProjectsService(prisma as never, {} as never, {} as never);

  beforeEach(() => jest.clearAllMocks());

  it('scopes the project list to the current anonymous visitor', async () => {
    await service.list('visitor-a');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { visitorId: 'visitor-a', expiresAt: { gt: expect.any(Date) } },
      }),
    );
  });

  it('returns not found when a project is outside the visitor scope', async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(service.get('visitor-b', 'project-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'project-a',
          visitorId: 'visitor-b',
          expiresAt: { gt: expect.any(Date) },
        },
      }),
    );
  });

  it('includes ordered character relationships and their endpoints in project details', async () => {
    findFirst.mockResolvedValueOnce({ versions: [], relationships: [] });

    await service.get('visitor-a', 'project-a');

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          relationships: {
            orderBy: { sortOrder: 'asc' },
            include: {
              source: { select: { id: true, name: true, sortOrder: true } },
              target: { select: { id: true, name: true, sortOrder: true } },
            },
          },
        }),
      }),
    );
  });

  it('assigns a seven-day expiry when a project is created', async () => {
    const create = jest.fn().mockResolvedValue({ versions: [] });
    const abuseProtection = {
      createOwnedProject: jest.fn().mockImplementation((_visitorId, _clientIp, operation) =>
        operation({ project: { create } }),
      ),
    };
    const creationService = new ProjectsService({} as never, abuseProtection as never, {} as never);
    const before = Date.now();

    await creationService.create('visitor-a', '127.0.0.1', {
      title: '测试项目',
      logline: '这是一个满足最短长度要求的故事创意。',
      genre: '剧情',
      tone: '克制',
      language: 'zh-CN',
      targetMinutes: 5,
    });

    const expiresAt = create.mock.calls[0][0].data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000);
  });

  it('preserves human-edited creative fields but replaces a trend safety envelope server-side', async () => {
    const create = jest.fn().mockResolvedValue({ versions: [] });
    const abuseProtection = {
      createOwnedProject: jest.fn().mockImplementation((_visitorId, _clientIp, operation) =>
        operation({
          trendTopic: { findUnique: jest.fn().mockResolvedValue({ id: 'trend-1' }) },
          project: { create },
        }),
      ),
    };
    const trendBriefs = {
      build: jest.fn().mockReturnValue({
        topic: { riskLevel: 'LOW' },
        brief: { prompt: 'SERVER_GENERATED_SAFE_PROMPT' },
        projectInput: { trendTopicId: 'trend-1' },
      }),
    };
    const creationService = new ProjectsService(
      {} as never,
      abuseProtection as never,
      trendBriefs as never,
    );

    await creationService.create('visitor-a', '127.0.0.1', {
      mode: ProjectMode.TREND_INSPIRED,
      trendTopicId: 'trend-1',
      title: '用户修改后的标题',
      logline: '这是用户修改后的完整故事梗概，会被保留下来。',
      sourceText: 'CLIENT_TAMPERED_PROMPT',
      genre: '悬疑',
      tone: '冷峻',
      language: 'zh-CN',
      targetMinutes: 12,
    });

    expect(create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      mode: ProjectMode.TREND_INSPIRED,
      trendTopicId: 'trend-1',
      title: '用户修改后的标题',
      logline: '这是用户修改后的完整故事梗概，会被保留下来。',
      genre: '悬疑',
      tone: '冷峻',
      targetMinutes: 12,
      sourceText: 'SERVER_GENERATED_SAFE_PROMPT',
    }));
  });

  it('does not create a REVIEW trend project without a durable approval workflow', async () => {
    const create = jest.fn();
    const abuseProtection = {
      createOwnedProject: jest.fn().mockImplementation((_visitorId, _clientIp, operation) =>
        operation({
          trendTopic: { findUnique: jest.fn().mockResolvedValue({ id: 'trend-review' }) },
          project: { create },
        }),
      ),
    };
    const trendBriefs = {
      build: jest.fn().mockReturnValue({
        topic: { riskLevel: 'REVIEW' },
        brief: { prompt: 'SAFE_PROMPT' },
        projectInput: { trendTopicId: 'trend-review' },
      }),
    };
    const creationService = new ProjectsService(
      {} as never,
      abuseProtection as never,
      trendBriefs as never,
    );

    await expect(creationService.create('visitor-a', '127.0.0.1', {
      mode: ProjectMode.TREND_INSPIRED,
      trendTopicId: 'trend-review',
      title: '审核项目',
      logline: '这是一个尚未完成人工审核的热点故事梗概。',
      genre: '剧情',
      tone: '克制',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(abuseProtection.createOwnedProject).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    GenerationJobStatus.QUEUED,
    GenerationJobStatus.RUNNING,
    GenerationJobStatus.RETRYING,
  ])('rejects deletion while the project has a %s generation job', async (status) => {
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-a' }),
        delete: jest.fn(),
      },
      generationJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'job-a', status }),
      },
    };
    const abuseProtection = {
      runSerializableTransaction: jest.fn().mockImplementation((operation) => operation(transaction)),
    };
    const deletionService = new ProjectsService(
      {} as never,
      abuseProtection as never,
      {} as never,
    );

    await expect(deletionService.remove('visitor-a', 'project-a')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(transaction.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'project-a',
        visitorId: 'visitor-a',
        expiresAt: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(transaction.generationJob.findFirst).toHaveBeenCalledWith({
      where: {
        projectId: 'project-a',
        status: {
          in: [
            GenerationJobStatus.QUEUED,
            GenerationJobStatus.RUNNING,
            GenerationJobStatus.RETRYING,
          ],
        },
      },
      select: { id: true },
    });
    expect(transaction.project.delete).not.toHaveBeenCalled();
  });

  it('deletes an owned, unexpired project only inside the shared serializable runner', async () => {
    const transaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-a' }),
        delete: jest.fn().mockResolvedValue({ id: 'project-a' }),
      },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const abuseProtection = {
      runSerializableTransaction: jest.fn().mockImplementation((operation) => operation(transaction)),
    };
    const rootPrisma = { project: { findFirst: jest.fn(), delete: jest.fn() } };
    const deletionService = new ProjectsService(
      rootPrisma as never,
      abuseProtection as never,
      {} as never,
    );

    await expect(deletionService.remove('visitor-a', 'project-a')).resolves.toEqual({
      deleted: true,
    });
    expect(abuseProtection.runSerializableTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      '删除项目冲突，请稍后重试',
    );
    expect(transaction.project.delete).toHaveBeenCalledWith({ where: { id: 'project-a' } });
    expect(rootPrisma.project.findFirst).not.toHaveBeenCalled();
    expect(rootPrisma.project.delete).not.toHaveBeenCalled();
  });

  it('preserves not-found semantics inside the deletion transaction', async () => {
    const transaction = {
      project: { findFirst: jest.fn().mockResolvedValue(null), delete: jest.fn() },
      generationJob: { findFirst: jest.fn() },
    };
    const abuseProtection = {
      runSerializableTransaction: jest.fn().mockImplementation((operation) => operation(transaction)),
    };
    const deletionService = new ProjectsService(
      {} as never,
      abuseProtection as never,
      {} as never,
    );

    await expect(deletionService.remove('visitor-b', 'project-a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction.generationJob.findFirst).not.toHaveBeenCalled();
    expect(transaction.project.delete).not.toHaveBeenCalled();
  });

  it('rechecks active jobs when the serializable runner replays after a concurrent enqueue', async () => {
    const firstTransaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-a' }),
        delete: jest.fn().mockResolvedValue({ id: 'project-a' }),
      },
      generationJob: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const replayTransaction = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-a' }),
        delete: jest.fn(),
      },
      generationJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job-concurrent' }) },
    };
    const abuseProtection = {
      runSerializableTransaction: jest.fn().mockImplementation(async (operation) => {
        await operation(firstTransaction);
        return operation(replayTransaction);
      }),
    };
    const deletionService = new ProjectsService(
      {} as never,
      abuseProtection as never,
      {} as never,
    );

    await expect(deletionService.remove('visitor-a', 'project-a')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(firstTransaction.project.delete).toHaveBeenCalledTimes(1);
    expect(replayTransaction.generationJob.findFirst).toHaveBeenCalledTimes(1);
    expect(replayTransaction.project.delete).not.toHaveBeenCalled();
  });
});
