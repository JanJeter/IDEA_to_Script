import { createHash } from 'node:crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrendPolicyAction, TrendRiskLevel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JsonFeedTrendSource } from './sources/json-feed-trend.source';
import { QianfanBaiduTrendSource } from './sources/qianfan-baidu-trend.source';
import { WikimediaTrendSource } from './sources/wikimedia-trend.source';
import { XWoeidTrendSource } from './sources/x-woeid-trend.source';
import { WeiboOfficialHotWordSource } from './sources/weibo-official-hot-word.source';
import { YouTubeMostPopularSource } from './sources/youtube-most-popular.source';
import { TrendPolicyService } from './trend-policy.service';
import { presentTrendTopic } from './trends.presenter';
import type {
  TrendCandidate,
  TrendFeedResponse,
  TrendSource,
  TrendSourceStatus,
} from './trends.types';

export function isTrendSourceSnapshotDue(
  observedAt: Array<Date | null>,
  ttlMs: number,
  now = Date.now(),
  fallbackObservedAt: Date | null = null,
) {
  return observedAt.length === 0 || observedAt.some(
    (value) => {
      const effectiveValue = value ?? fallbackObservedAt;
      return !effectiveValue || now - effectiveValue.getTime() >= ttlMs;
    },
  );
}

@Injectable()
export class TrendsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrendsService.name);
  private readonly sourceStatuses = new Map<string, TrendSourceStatus>();
  private readonly nextSourceAttemptAt = new Map<string, number>();
  private readonly sourceFailureCounts = new Map<string, number>();
  private refreshInFlight?: Promise<void>;
  private refreshTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private readonly lastManualRefreshAt = new Map<string, number>();
  private readonly maxManualRefreshEntries = 1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly policy: TrendPolicyService,
    private readonly wikimedia: WikimediaTrendSource,
    private readonly jsonFeed: JsonFeedTrendSource,
    private readonly qianfan: QianfanBaiduTrendSource,
    private readonly xWoeid: XWoeidTrendSource,
    private readonly weibo: WeiboOfficialHotWordSource,
    private readonly youtube: YouTubeMostPopularSource,
  ) {
    for (const source of this.sources) {
      this.sourceStatuses.set(source.id, {
        id: source.id,
        label: source.label,
        status: 'error',
        message: '等待首次同步',
        lastSuccessAt: null,
        stale: true,
      });
    }
  }

  onModuleInit() {
    if (this.config.get<string>('RESTORE_VERIFY_MODE', 'false') === 'true') return;
    const intervalMs = this.integerConfig(
      'TRENDS_REFRESH_INTERVAL_MS',
      15 * 60 * 1000,
      60_000,
      24 * 60 * 60 * 1000,
    );
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((error) => this.logRefreshFailure(error));
    }, intervalMs);
    this.refreshTimer.unref();
    this.cleanupTimer = setInterval(() => {
      void this.cleanupRetention().catch((error) => {
        this.logger.warn(`Trend retention cleanup failed: ${this.safeError(error)}`);
      });
    }, 24 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.cleanupRetention().catch((error) => {
      this.logger.warn(`Trend retention cleanup failed: ${this.safeError(error)}`);
    });
    void this.refresh().catch((error) => this.logRefreshFailure(error));
  }

  onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async list(): Promise<TrendFeedResponse> {
    const snapshot = await this.latestSnapshot();
    // Keep the public page responsive while each source independently checks its
    // persisted/in-process freshness. Missing snapshots are naturally due, so the
    // initial path must not bypass the same TTL logic used by later requests.
    void this.refresh().catch((error) => this.logRefreshFailure(error));
    await this.hydrateStatusesFromSnapshots();
    return this.presentSnapshot(snapshot);
  }

  async refreshManual(clientKey: string): Promise<TrendFeedResponse> {
    const now = Date.now();
    const cooldownMs = this.integerConfig('TRENDS_REFRESH_COOLDOWN_MS', 60_000, 5_000, 60 * 60 * 1000);
    const previous = this.lastManualRefreshAt.get(clientKey) ?? 0;
    if (now - previous < cooldownMs) {
      throw new HttpException('热点刷新过于频繁，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.lastManualRefreshAt.has(clientKey) && this.lastManualRefreshAt.size >= this.maxManualRefreshEntries) {
      for (const [key, value] of this.lastManualRefreshAt) {
        if (now - value > cooldownMs) this.lastManualRefreshAt.delete(key);
      }
      if (this.lastManualRefreshAt.size >= this.maxManualRefreshEntries) {
        throw new HttpException('热点刷新请求较多，请稍后再试', HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    this.lastManualRefreshAt.set(clientKey, now);
    // Shared DB freshness prevents multiple replicas or many visitors from bypassing source TTL.
    await this.refresh().catch((error) => this.logRefreshFailure(error));
    await this.hydrateStatusesFromSnapshots();
    return this.presentSnapshot(await this.latestSnapshot());
  }

  private refresh() {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async performRefresh() {
    const enabledSources = this.sources;
    const sourcesToFetch = await this.sourcesDueForRefresh(enabledSources);
    if (sourcesToFetch.length === 0) {
      await this.hydrateStatusesFromSnapshots();
      return;
    }

    const candidates: TrendCandidate[] = [];
    const successfulSources: Array<{ source: TrendSource; count: number }> = [];
    for (const source of sourcesToFetch) {
      this.beginSourceAttempt(source.id);
      try {
        const items = await source.fetch();
        candidates.push(...items);
        successfulSources.push({ source, count: items.length });
      } catch (error) {
        this.deferSourceRetry(source.id);
        const internalMessage = this.safeError(error);
        this.logger.warn(`${source.id} refresh failed: ${internalMessage}`);
        const previous = this.sourceStatuses.get(source.id);
        this.sourceStatuses.set(source.id, {
          id: source.id,
          label: source.label,
          status: 'error',
          message: '本轮同步失败，已保留上次成功快照',
          lastSuccessAt: previous?.lastSuccessAt ?? null,
          stale: previous?.stale ?? true,
          degraded: true,
        });
      }
    }
    const normalizedCandidates = candidates.map((item) => ({
      ...item,
      externalId: createHash('sha256')
        .update(`${item.source}:${item.externalId}`)
        .digest('hex'),
    }));
    const unique = [...new Map(
      normalizedCandidates.map((item) => [`${item.source}:${item.externalId}`, item]),
    ).values()];
    if (unique.length === 0) {
      const completedAt = new Date();
      for (const { source, count } of successfulSources) {
        const report = source.fetchReport?.();
        this.completeSourceAttempt(source.id, report?.degraded ?? false);
        this.sourceStatuses.set(source.id, {
          id: source.id,
          label: source.label,
          status: 'ok',
          message: report?.message ?? `本轮同步 ${count} 条`,
          lastSuccessAt: completedAt.toISOString(),
          stale: false,
          degraded: report?.degraded ?? false,
        });
      }
      return;
    }

    const observedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      for (const candidate of unique) {
        const decision = this.policy.evaluate(candidate);
        const persisted = decision.riskLevel === 'BLOCKED'
          ? this.redactBlockedCandidate(candidate, decision.reasons)
          : candidate;
        const existing = await transaction.trendTopic.findUnique({
          where: { source_externalId: { source: persisted.source, externalId: persisted.externalId } },
        });
        const heatScore = this.heatScore(candidate, decision.riskLevel, unique);
        const momentumScore = this.momentumScore(candidate, existing);
        const topic = await transaction.trendTopic.upsert({
          where: { source_externalId: { source: persisted.source, externalId: persisted.externalId } },
          create: {
            source: persisted.source,
            externalId: persisted.externalId,
            title: persisted.title,
            excerpt: persisted.excerpt,
            sourceLabel: persisted.sourceLabel,
            sourceUrl: persisted.sourceUrl,
            license: persisted.license,
            category: decision.category,
            rank: candidate.rank,
            views: candidate.views,
            heatScore,
            momentumScore,
            riskLevel: decision.riskLevel as TrendRiskLevel,
            policyAction: decision.action as TrendPolicyAction,
            riskReasons: decision.reasons,
            publishedAt: persisted.publishedAt,
            firstSeenAt: observedAt,
            lastSeenAt: observedAt,
          },
          update: {
            title: persisted.title,
            excerpt: persisted.excerpt,
            sourceLabel: persisted.sourceLabel,
            sourceUrl: persisted.sourceUrl,
            license: persisted.license,
            category: decision.category,
            rank: candidate.rank,
            views: candidate.views,
            heatScore,
            momentumScore,
            riskLevel: decision.riskLevel as TrendRiskLevel,
            policyAction: decision.action as TrendPolicyAction,
            riskReasons: decision.reasons,
            publishedAt: persisted.publishedAt,
            lastSeenAt: observedAt,
          },
        });
        await transaction.trendObservation.create({
          data: {
            trendTopicId: topic.id,
            rank: candidate.rank,
            views: candidate.views,
            heatScore,
            momentumScore,
            observedAt,
          },
        });
      }
    }, { timeout: 30_000 });
    for (const { source, count } of successfulSources) {
      const report = source.fetchReport?.();
      this.completeSourceAttempt(source.id, report?.degraded ?? false);
      this.sourceStatuses.set(source.id, {
        id: source.id,
        label: source.label,
        status: 'ok',
        message: report?.message ?? `本轮同步 ${count} 条`,
        lastSuccessAt: observedAt.toISOString(),
        stale: false,
        degraded: report?.degraded ?? false,
      });
    }
  }

  private async latestSnapshot() {
    const snapshots = await Promise.all(this.sources.flatMap((source) =>
      this.topicSourceFilters(source).map(async (sourceFilter) => {
      const latest = await this.prisma.trendObservation.findFirst({
        where: { trendTopic: { source: sourceFilter } },
        orderBy: { observedAt: 'desc' },
        select: { observedAt: true },
      });
      if (!latest) return { refreshedAt: null, topics: [] };
      const observations = await this.prisma.trendObservation.findMany({
        where: {
          observedAt: latest.observedAt,
          trendTopic: { source: sourceFilter },
        },
        include: { trendTopic: true },
      });
      return {
        refreshedAt: latest.observedAt,
        topics: observations.map((item) => item.trendTopic),
      };
      }),
    ));
    const refreshedAt = snapshots.reduce<Date | null>((newest, snapshot) => {
      if (!snapshot.refreshedAt) return newest;
      return !newest || snapshot.refreshedAt > newest ? snapshot.refreshedAt : newest;
    }, null);
    const topics = [...new Map(
      snapshots.flatMap((snapshot) => snapshot.topics).map((topic) => [topic.id, topic]),
    ).values()].sort((left, right) => right.heatScore - left.heatScore || (left.rank ?? 999) - (right.rank ?? 999));
    return { refreshedAt, topics };
  }

  private async hydrateStatusesFromSnapshots() {
    for (const source of this.sources) {
      const current = this.sourceStatuses.get(source.id) ?? {
        id: source.id,
        label: source.label,
        status: 'error' as const,
        message: '等待首次同步',
        lastSuccessAt: null,
        stale: true,
      };
      const latestByStorageSource = await Promise.all(this.topicSourceFilters(source).map((sourceFilter) =>
        this.prisma.trendObservation.findFirst({
          where: { trendTopic: { source: sourceFilter } },
          orderBy: { observedAt: 'desc' },
          select: { observedAt: true },
        }),
      ));
      const observedTimes = latestByStorageSource.flatMap((latest) => latest?.observedAt ? [latest.observedAt] : []);
      const newest = observedTimes.reduce<Date | null>(
        (value, item) => !value || item > value ? item : value,
        null,
      );
      const stale = latestByStorageSource.length === 0 || latestByStorageSource.some(
        (latest) => !latest || this.isStale(latest.observedAt),
      );
      if (current.message !== '等待首次同步') {
        this.sourceStatuses.set(source.id, {
          ...current,
          lastSuccessAt: newest?.toISOString() ?? current.lastSuccessAt,
          stale,
        });
      } else if (newest) {
        this.sourceStatuses.set(source.id, {
          id: source.id,
          label: source.label,
          status: stale ? 'error' : 'ok',
          message: stale ? '持久化快照已经过期' : '使用持久化快照，尚未到下一刷新时间',
          lastSuccessAt: newest.toISOString(),
          stale,
          degraded: stale,
        });
      }
    }
  }

  private topicSourceFilters(source: TrendSource) {
    if (source.storageSourceIds) return source.storageSourceIds();
    if (source.id === this.jsonFeed.id) return [{ startsWith: 'json:' } as const];
    return [source.id];
  }

  private presentSnapshot(snapshot: Awaited<ReturnType<TrendsService['latestSnapshot']>>): TrendFeedResponse {
    return {
      items: snapshot.topics.map(presentTrendTopic),
      refreshedAt: snapshot.refreshedAt?.toISOString() ?? null,
      stale: !snapshot.refreshedAt || this.sources.some(
        (source) => this.sourceStatuses.get(source.id)?.stale ?? true,
      ),
      sources: this.sources.map((source) => this.sourceStatuses.get(source.id) ?? {
        id: source.id,
        label: source.label,
        status: 'error' as const,
        message: '尚未同步',
        lastSuccessAt: null,
        stale: true,
      }),
    };
  }

  private heatScore(candidate: TrendCandidate, riskLevel: string, allCandidates: TrendCandidate[]) {
    const peers = allCandidates.filter((item) => item.source === candidate.source);
    const rankOrder = [...peers].sort((left, right) => (left.rank ?? 9999) - (right.rank ?? 9999));
    const rankIndex = rankOrder.indexOf(candidate);
    const rankScore = rankOrder.length <= 1 ? 80 : 100 - rankIndex / (rankOrder.length - 1) * 70;
    const viewed = peers.filter((item) => item.views !== null).sort(
      (left, right) => (right.views ?? 0) - (left.views ?? 0),
    );
    const viewIndex = viewed.indexOf(candidate);
    const viewScore = viewIndex < 0
      ? 50
      : viewed.length <= 1 ? 80 : 100 - viewIndex / (viewed.length - 1) * 70;
    const riskMultiplier = riskLevel === 'BLOCKED' ? 0 : riskLevel === 'REVIEW' ? 0.75 : 1;
    return Math.round((rankScore * 0.6 + viewScore * 0.4) * riskMultiplier);
  }

  private momentumScore(candidate: TrendCandidate, existing: { rank: number | null; views: number | null } | null) {
    if (!existing) return 0;
    const rankDelta = candidate.rank !== null && existing.rank !== null
      ? Math.max(-50, Math.min(50, (existing.rank - candidate.rank) * 4))
      : 0;
    const viewDelta = candidate.views !== null && existing.views
      ? Math.max(-50, Math.min(50, (candidate.views / existing.views - 1) * 100))
      : 0;
    return Math.round((rankDelta + viewDelta) / 2);
  }

  private isStale(value: Date) {
    const staleAfterMs = this.integerConfig(
      'TRENDS_STALE_AFTER_MS',
      6 * 60 * 60 * 1000,
      60_000,
      7 * 24 * 60 * 60 * 1000,
    );
    return Date.now() - value.getTime() >= staleAfterMs;
  }

  private sourceFetchTtlMs(source: TrendSource) {
    return source.fetchTtlMs?.() ?? this.integerConfig(
      'TRENDS_FETCH_TTL_MS',
      2 * 60 * 60 * 1000,
      60_000,
      24 * 60 * 60 * 1000,
    );
  }

  private async sourcesDueForRefresh(sources: TrendSource[]) {
    const due = await Promise.all(sources.map(async (source) => {
      const nextAttemptAt = this.nextSourceAttemptAt.get(source.id) ?? 0;
      if (nextAttemptAt > Date.now()) return false;
      if (nextAttemptAt > 0) this.nextSourceAttemptAt.delete(source.id);
      const filters = this.topicSourceFilters(source);
      if (filters.length === 0) return true;
      const latest = await Promise.all(filters.map((sourceFilter) =>
        this.prisma.trendObservation.findFirst({
          where: { trendTopic: { source: sourceFilter } },
          orderBy: { observedAt: 'desc' },
          select: { observedAt: true },
        }),
      ));
      const statusLastSuccess = this.sourceStatuses.get(source.id)?.lastSuccessAt;
      const fallbackObservedAt = statusLastSuccess ? new Date(statusLastSuccess) : null;
      return isTrendSourceSnapshotDue(
        latest.map((item) => item?.observedAt ?? null),
        this.sourceFetchTtlMs(source),
        Date.now(),
        fallbackObservedAt && !Number.isNaN(fallbackObservedAt.getTime())
          ? fallbackObservedAt
          : null,
      );
    }));
    return sources.filter((_, index) => due[index]);
  }

  private beginSourceAttempt(sourceId: string) {
    this.nextSourceAttemptAt.set(
      sourceId,
      Date.now() + this.sourceFailureBackoffMs(),
    );
  }

  private deferSourceRetry(sourceId: string) {
    const failures = Math.min(8, (this.sourceFailureCounts.get(sourceId) ?? 0) + 1);
    this.sourceFailureCounts.set(sourceId, failures);
    const delayMs = Math.min(
      60 * 60 * 1000,
      this.sourceFailureBackoffMs() * 2 ** (failures - 1),
    );
    this.nextSourceAttemptAt.set(sourceId, Date.now() + delayMs);
  }

  private completeSourceAttempt(sourceId: string, degraded: boolean) {
    if (degraded) {
      this.deferSourceRetry(sourceId);
      return;
    }
    this.sourceFailureCounts.delete(sourceId);
    this.nextSourceAttemptAt.delete(sourceId);
  }

  private sourceFailureBackoffMs() {
    return this.integerConfig(
      'TRENDS_SOURCE_FAILURE_BACKOFF_MS',
      5 * 60 * 1000,
      60_000,
      60 * 60 * 1000,
    );
  }

  private async cleanupRetention() {
    const retentionDays = this.integerConfig('TRENDS_RETENTION_DAYS', 14, 1, 90);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    // YouTube Non-Authorized API Data must be refreshed or deleted within 30 days.
    // Use 28 days so the daily cleanup remains safely inside that window even if
    // one scheduled run is delayed. Linked projects retain only an app-owned,
    // non-identifying placeholder needed for the generation risk gate.
    const youtubeCutoff = new Date(
      Date.now() - Math.min(retentionDays, 28) * 24 * 60 * 60 * 1000,
    );
    await this.prisma.trendObservation.deleteMany({
      where: {
        observedAt: { lt: youtubeCutoff },
        trendTopic: { source: { startsWith: 'youtube.most_popular.' } },
      },
    });
    const linkedExpiredYouTubeTopics = await this.prisma.trendTopic.findMany({
      where: {
        source: { startsWith: 'youtube.most_popular.' },
        lastSeenAt: { lt: youtubeCutoff },
        projects: { some: {} },
      },
      select: { id: true },
    });
    for (const topic of linkedExpiredYouTubeTopics) {
      await this.prisma.trendTopic.update({
        where: { id: topic.id },
        data: {
          externalId: createHash('sha256')
            .update(`expired-youtube:${topic.id}`)
            .digest('hex'),
          title: '已清除的 YouTube 发现信号',
          excerpt: '原始 YouTube API 数据已按保留政策清除。',
          sourceLabel: 'YouTube（原始 API 数据已清除）',
          sourceUrl: 'https://www.youtube.com/',
          license: 'YouTube Data API v3；原始 API 数据已按保留政策清除',
          category: '社会观察',
          rank: null,
          views: null,
          heatScore: 0,
          momentumScore: 0,
          publishedAt: null,
        },
      });
    }
    await this.prisma.trendTopic.deleteMany({
      where: {
        source: { startsWith: 'youtube.most_popular.' },
        lastSeenAt: { lt: youtubeCutoff },
        projects: { none: {} },
      },
    });
    await this.prisma.trendObservation.deleteMany({ where: { observedAt: { lt: cutoff } } });
    await this.prisma.trendTopic.deleteMany({
      where: { lastSeenAt: { lt: cutoff }, projects: { none: {} } },
    });
  }

  private redactBlockedCandidate(candidate: TrendCandidate, reasons: string[]): TrendCandidate {
    const sourceOrigin = new URL(candidate.sourceUrl).origin;
    return {
      ...candidate,
      title: '已阻断的高风险信号',
      excerpt: `该条目未公开原始内容：${reasons.join('；')}`.slice(0, 500),
      sourceUrl: sourceOrigin,
    };
  }

  private get sources(): TrendSource[] {
    return [
      this.wikimedia,
      this.qianfan,
      this.weibo,
      this.xWoeid,
      this.youtube,
      this.jsonFeed,
    ]
      .filter((source) => source.enabled);
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 200) : '来源暂时不可用';
  }

  private logRefreshFailure(error: unknown) {
    this.logger.warn(`Trend refresh failed without affecting API availability: ${this.safeError(error)}`);
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
