import { ConfigService } from '@nestjs/config';
import { TrendPolicyService } from './trend-policy.service';
import { isTrendSourceSnapshotDue, TrendsService } from './trends.service';
import type { TrendSource } from './trends.types';

describe('isTrendSourceSnapshotDue', () => {
  const now = new Date('2026-08-14T00:30:00.000Z').getTime();

  it('evaluates freshness independently for each source cadence', () => {
    const observedAt = [new Date('2026-08-14T00:20:00.000Z')];

    expect(isTrendSourceSnapshotDue(observedAt, 30 * 60 * 1000, now)).toBe(false);
    expect(isTrendSourceSnapshotDue(observedAt, 5 * 60 * 1000, now)).toBe(true);
  });

  it('fetches a newly enabled or partially missing storage source', () => {
    const fresh = new Date('2026-08-14T00:29:00.000Z');

    expect(isTrendSourceSnapshotDue([], 30 * 60 * 1000, now)).toBe(true);
    expect(isTrendSourceSnapshotDue([fresh, null], 30 * 60 * 1000, now)).toBe(true);
    expect(isTrendSourceSnapshotDue([fresh, fresh], 30 * 60 * 1000, now)).toBe(false);
  });

  it('uses an in-process successful empty fetch as the TTL fallback', () => {
    const emptyFetchSucceededAt = new Date('2026-08-14T00:29:00.000Z');

    expect(isTrendSourceSnapshotDue(
      [null],
      30 * 60 * 1000,
      now,
      emptyFetchSucceededAt,
    )).toBe(false);
    expect(isTrendSourceSnapshotDue(
      [null],
      30 * 60 * 1000,
      now + 31 * 60 * 1000,
      emptyFetchSucceededAt,
    )).toBe(true);
  });
});

describe('TrendsService YouTube retention', () => {
  afterEach(() => jest.useRealTimers());

  it('scrubs linked API data within 28 days even when general retention is longer', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const prisma = {
      trendObservation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      trendTopic: {
        findMany: jest.fn().mockResolvedValue([{ id: 'linked-youtube-topic' }]),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = Object.create(TrendsService.prototype) as TrendsService;
    Object.defineProperty(service, 'prisma', { value: prisma });
    Object.defineProperty(service, 'config', {
      value: new ConfigService({ TRENDS_RETENTION_DAYS: '90' }),
    });
    const cleanupRetention = Reflect.get(service, 'cleanupRetention') as () => Promise<void>;

    await cleanupRetention.call(service);

    const youtubeCutoff = new Date('2026-07-17T00:00:00.000Z');
    expect(prisma.trendObservation.deleteMany).toHaveBeenCalledWith({
      where: {
        observedAt: { lt: youtubeCutoff },
        trendTopic: { source: { startsWith: 'youtube.most_popular.' } },
      },
    });
    expect(prisma.trendTopic.update).toHaveBeenCalledWith({
      where: { id: 'linked-youtube-topic' },
      data: expect.objectContaining({
        externalId: expect.stringMatching(/^[a-f0-9]{64}$/),
        title: '已清除的 YouTube 发现信号',
        sourceUrl: 'https://www.youtube.com/',
        rank: null,
        views: null,
        heatScore: 0,
        momentumScore: 0,
      }),
    });
  });
});

describe('TrendsService empty-source cadence', () => {
  it('does not refetch a successful empty source on the next list request', async () => {
    const source: TrendSource = {
      id: 'empty.official.source',
      label: 'Empty official source',
      enabled: true,
      fetch: jest.fn().mockResolvedValue([]),
      fetchTtlMs: () => 30 * 60 * 1000,
      storageSourceIds: () => ['empty.official.source'],
    };
    const disabledSource: TrendSource = {
      id: 'disabled.source',
      label: 'Disabled source',
      enabled: false,
      fetch: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      trendObservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new TrendsService(
      prisma as never,
      new ConfigService(),
      new TrendPolicyService(),
      source as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
    );
    const waitForRefresh = async () => {
      const inFlight = Reflect.get(service, 'refreshInFlight') as Promise<void> | undefined;
      if (inFlight) await inFlight;
    };

    await service.list();
    await waitForRefresh();
    expect(source.fetch).toHaveBeenCalledTimes(1);

    await service.list();
    await waitForRefresh();
    expect(source.fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off a rejected source between consecutive list requests', async () => {
    const source: TrendSource = {
      id: 'failing.official.source',
      label: 'Failing official source',
      enabled: true,
      fetch: jest.fn().mockRejectedValue(new Error('upstream unavailable')),
      fetchTtlMs: () => 30 * 60 * 1000,
      storageSourceIds: () => ['failing.official.source'],
    };
    const disabledSource = { ...source, id: 'disabled.source', enabled: false };
    const prisma = {
      trendObservation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new TrendsService(
      prisma as never,
      new ConfigService(),
      new TrendPolicyService(),
      source as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
    );
    const waitForRefresh = async () => {
      const inFlight = Reflect.get(service, 'refreshInFlight') as Promise<void> | undefined;
      if (inFlight) await inFlight;
    };

    await service.list();
    await waitForRefresh();
    await service.list();
    await waitForRefresh();

    expect(source.fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off a degraded partial source even when a storage snapshot is old', async () => {
    const source: TrendSource = {
      id: 'partial.official.source',
      label: 'Partial official source',
      enabled: true,
      fetch: jest.fn().mockResolvedValue([]),
      fetchReport: () => ({ degraded: true }),
      fetchTtlMs: () => 30 * 60 * 1000,
      storageSourceIds: () => ['partial.official.source.region'],
    };
    const disabledSource = { ...source, id: 'disabled.source', enabled: false };
    const oldSnapshot = { observedAt: new Date(Date.now() - 60 * 60 * 1000) };
    const prisma = {
      trendObservation: {
        findFirst: jest.fn().mockResolvedValue(oldSnapshot),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new TrendsService(
      prisma as never,
      new ConfigService(),
      new TrendPolicyService(),
      source as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
      disabledSource as never,
    );
    const waitForRefresh = async () => {
      const inFlight = Reflect.get(service, 'refreshInFlight') as Promise<void> | undefined;
      if (inFlight) await inFlight;
    };

    await service.list();
    await waitForRefresh();
    await service.list();
    await waitForRefresh();

    expect(source.fetch).toHaveBeenCalledTimes(1);
  });
});
