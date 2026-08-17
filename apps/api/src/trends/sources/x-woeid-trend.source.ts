import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  TrendCandidate,
  TrendSource,
  TrendSourceFetchReport,
} from '../trends.types';
import {
  fetchJson,
  finiteInteger,
  safePublicSourceUrl,
  sanitizePlainText,
} from '../trend-text';

const officialWoeidLabels = {
  '1': '全球',
  '23424977': '美国',
  '23424975': '英国',
  '23424856': '日本',
  '2459115': '纽约',
  '2442047': '洛杉矶',
  '44418': '伦敦',
  '1118370': '东京',
} as const;

type OfficialXWoeid = keyof typeof officialWoeidLabels;
type XTrendItem = {
  trend_name?: unknown;
  tweet_count?: unknown;
  post_count?: unknown;
};
type XTrendResponse = {
  data?: XTrendItem[];
};

const defaultWoeids: OfficialXWoeid[] = ['23424977', '23424975'];
const X_MAX_TRENDS = 20;
const X_REQUEST_ATTEMPTS = 1;

export function parseXWoeids(value: string | undefined): OfficialXWoeid[] {
  const configured = value?.trim() ? value.split(',') : defaultWoeids;
  return [...new Set(configured.map((item) => item.trim()))]
    .filter((item): item is OfficialXWoeid => (
      Object.prototype.hasOwnProperty.call(officialWoeidLabels, item)
    ));
}

@Injectable()
export class XWoeidTrendSource implements TrendSource {
  readonly id = 'x.woeid';
  readonly label = 'X 官方地区趋势';
  private readonly logger = new Logger(XWoeidTrendSource.name);
  private report: TrendSourceFetchReport = {};
  private nextAllowedAt = 0;

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.config.get<string>('TRENDS_X_BEARER_TOKEN', '').trim())
      && this.useCaseApproved();
  }

  storageSourceIds() {
    return this.configuredWoeids().map((woeid) => this.sourceId(woeid));
  }

  fetchReport() {
    return this.report;
  }

  fetchTtlMs() {
    return this.integerConfig(
      'TRENDS_X_FETCH_TTL_MS',
      30 * 60 * 1000,
      15 * 60 * 1000,
      24 * 60 * 60 * 1000,
    );
  }

  async fetch(): Promise<TrendCandidate[]> {
    const bearerToken = this.config.get<string>('TRENDS_X_BEARER_TOKEN', '').trim();
    if (!bearerToken || !this.useCaseApproved()) return [];
    if (Date.now() < this.nextAllowedAt) {
      throw new Error('X API rate-limit window has not reset');
    }

    const woeids = this.configuredWoeids();
    if (woeids.length === 0) {
      throw new Error('TRENDS_X_WOEIDS contains no officially documented WOEID');
    }

    this.report = {};
    const candidates: TrendCandidate[] = [];
    const failedWoeids: OfficialXWoeid[] = [];
    for (const woeid of woeids) {
      if (Date.now() < this.nextAllowedAt) {
        failedWoeids.push(woeid);
        continue;
      }
      try {
        candidates.push(...await this.fetchWoeid(woeid, bearerToken));
      } catch (error) {
        this.captureRateLimit(error);
        failedWoeids.push(woeid);
        this.logger.warn(
          `X trends for WOEID ${woeid} failed: ${this.safeError(error)}`,
        );
      }
    }

    const successfulCount = woeids.length - failedWoeids.length;
    if (successfulCount === 0) {
      throw new Error('All configured X WOEID trend requests failed');
    }
    this.report = failedWoeids.length > 0
      ? {
          degraded: true,
          message: `同步 ${successfulCount}/${woeids.length} 个 X 地区；${failedWoeids.map((woeid) => officialWoeidLabels[woeid]).join('、')}沿用最近成功快照`,
        }
      : {
          degraded: false,
          message: `同步 ${successfulCount} 个 X 地区趋势`,
        };
    return candidates;
  }

  private configuredWoeids() {
    return parseXWoeids(this.config.get<string>('TRENDS_X_WOEIDS'));
  }

  private useCaseApproved() {
    const configured = this.config.get<unknown>('TRENDS_X_USE_CASE_APPROVED');
    return configured === true || (
      typeof configured === 'string'
      && configured.trim().toLocaleLowerCase('en-US') === 'true'
    );
  }

  private async fetchWoeid(woeid: OfficialXWoeid, bearerToken: string) {
    const url = new URL(`https://api.x.com/2/trends/by/woeid/${woeid}`);
    url.searchParams.set('max_trends', String(X_MAX_TRENDS));
    url.searchParams.set('trend.fields', 'trend_name,tweet_count');
    const payload = await fetchJson(url.toString(), {
      timeoutMs: this.integerConfig('TRENDS_SOURCE_TIMEOUT_MS', 8_000, 1_000, 30_000),
      maxBytes: this.integerConfig(
        'TRENDS_MAX_RESPONSE_BYTES',
        1024 * 1024,
        16_384,
        4 * 1024 * 1024,
      ),
      attempts: X_REQUEST_ATTEMPTS,
      redirect: 'error',
      userAgent: this.config.get<string>(
        'TRENDS_USER_AGENT',
        'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
      ),
      headers: { Authorization: `Bearer ${bearerToken}` },
    }) as XTrendResponse;

    const items = Array.isArray(payload.data) ? payload.data : [];
    return items.flatMap((item, index) => {
      const title = sanitizePlainText(item.trend_name, 180);
      if (!title) return [];
      const sourceUrl = this.searchUrl(title);
      if (!sourceUrl) return [];
      const tweetCount = finiteInteger(item.tweet_count);
      const postCount = finiteInteger(item.post_count);
      return [{
        source: this.sourceId(woeid),
        sourceLabel: `X ${officialWoeidLabels[woeid]}趋势`,
        externalId: createHash('sha256')
          .update(`${woeid}:${title.toLocaleLowerCase('en-US')}`)
          .digest('hex'),
        title,
        excerpt: '海外多语言趋势，待人工审阅',
        sourceUrl,
        license: 'X API v2 地区趋势；仅保存趋势名、公开计数、地区和来源链接，不保存原帖或账号',
        category: '社会观察',
        rank: index + 1,
        views: tweetCount ?? postCount,
        publishedAt: null,
      } satisfies TrendCandidate];
    }).slice(0, X_MAX_TRENDS);
  }

  private searchUrl(title: string) {
    const url = new URL('https://x.com/search');
    url.searchParams.set('q', title);
    url.searchParams.set('src', 'typed_query');
    return safePublicSourceUrl(url.toString());
  }

  private sourceId(woeid: OfficialXWoeid) {
    return `x.woeid.${woeid}`;
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 160) : 'region unavailable';
  }

  private captureRateLimit(error: unknown) {
    if (!(error instanceof Error) || !error.message.startsWith('HTTP 429 ')) return;
    const retryAfterMs = (error as Error & { retryAfterMs?: number }).retryAfterMs;
    if (Number.isFinite(retryAfterMs) && (retryAfterMs ?? 0) > 0) {
      const boundedDelay = Math.min(retryAfterMs ?? 0, 24 * 60 * 60 * 1000);
      this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + boundedDelay);
    }
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
