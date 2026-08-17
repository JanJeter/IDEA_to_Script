import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  TrendCandidate,
  TrendSource,
  TrendSourceFetchReport,
} from '../trends.types';
import { fetchJson, finiteInteger, sanitizePlainText } from '../trend-text';

const youtubeRegionLabels = {
  US: '美国',
  GB: '英国',
  JP: '日本',
  KR: '韩国',
  CA: '加拿大',
  AU: '澳大利亚',
  DE: '德国',
  FR: '法国',
  IN: '印度',
  BR: '巴西',
  MX: '墨西哥',
  TW: '中国台湾',
  HK: '中国香港',
  SG: '新加坡',
} as const;

type YouTubeRegion = keyof typeof youtubeRegionLabels;
type YouTubeVideoItem = {
  id?: unknown;
  snippet?: {
    title?: unknown;
    categoryId?: unknown;
  };
  statistics?: {
    viewCount?: unknown;
  };
};
type YouTubeVideoListResponse = {
  items?: YouTubeVideoItem[];
};

const defaultRegions: YouTubeRegion[] = ['US', 'GB'];
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeRegions(value: string | undefined): YouTubeRegion[] {
  const configured = value?.trim() ? value.split(',') : defaultRegions;
  return [...new Set(configured.map((item) => item.trim().toUpperCase()))]
    .filter((item): item is YouTubeRegion => (
      Object.prototype.hasOwnProperty.call(youtubeRegionLabels, item)
    ));
}

@Injectable()
export class YouTubeMostPopularSource implements TrendSource {
  readonly id = 'youtube.most_popular';
  readonly label = 'YouTube 官方热门（音乐、电影、游戏）';
  private readonly logger = new Logger(YouTubeMostPopularSource.name);
  private report: TrendSourceFetchReport = {};

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.config.get<string>('TRENDS_YOUTUBE_API_KEY', '').trim())
      && this.derivativeUseApproved();
  }

  storageSourceIds() {
    return this.configuredRegions().map((region) => this.sourceId(region));
  }

  fetchReport() {
    return this.report;
  }

  fetchTtlMs() {
    return this.integerConfig(
      'TRENDS_YOUTUBE_FETCH_TTL_MS',
      60 * 60 * 1000,
      30 * 60 * 1000,
      24 * 60 * 60 * 1000,
    );
  }

  async fetch(): Promise<TrendCandidate[]> {
    const apiKey = this.config.get<string>('TRENDS_YOUTUBE_API_KEY', '').trim();
    if (!apiKey || !this.derivativeUseApproved()) return [];
    const regions = this.configuredRegions();
    if (regions.length === 0) {
      throw new Error('TRENDS_YOUTUBE_REGIONS contains no supported region');
    }

    this.report = {};
    const candidates: TrendCandidate[] = [];
    const failedRegions: YouTubeRegion[] = [];
    for (const region of regions) {
      try {
        candidates.push(...await this.fetchRegion(region, apiKey));
      } catch (error) {
        failedRegions.push(region);
        this.logger.warn(
          `YouTube mostPopular for ${region} failed: ${this.safeError(error)}`,
        );
      }
    }

    const successfulCount = regions.length - failedRegions.length;
    if (successfulCount === 0) {
      throw new Error('All configured YouTube mostPopular requests failed');
    }
    this.report = failedRegions.length > 0
      ? {
          degraded: true,
          message: `同步 ${successfulCount}/${regions.length} 个 YouTube 地区；${failedRegions.map((region) => youtubeRegionLabels[region]).join('、')}沿用最近成功快照`,
        }
      : {
          degraded: false,
          message: `同步 ${successfulCount} 个 YouTube 地区热门榜`,
        };
    return candidates;
  }

  private configuredRegions() {
    return parseYouTubeRegions(
      this.config.get<string>('TRENDS_YOUTUBE_REGIONS'),
    );
  }

  private derivativeUseApproved() {
    const configured = this.config.get<unknown>(
      'TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED',
    );
    return configured === true || (
      typeof configured === 'string'
      && configured.trim().toLocaleLowerCase('en-US') === 'true'
    );
  }

  private async fetchRegion(region: YouTubeRegion, apiKey: string) {
    const limit = this.integerConfig('TRENDS_YOUTUBE_LIMIT_PER_REGION', 20, 1, 50);
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,statistics');
    url.searchParams.set('fields', 'items(id,snippet(title,categoryId),statistics(viewCount))');
    url.searchParams.set('chart', 'mostPopular');
    url.searchParams.set('regionCode', region);
    url.searchParams.set('maxResults', String(limit));
    url.searchParams.set('key', apiKey);
    const payload = await fetchJson(url.toString(), {
      timeoutMs: this.integerConfig(
        'TRENDS_SOURCE_TIMEOUT_MS',
        8_000,
        1_000,
        30_000,
      ),
      maxBytes: this.integerConfig(
        'TRENDS_MAX_RESPONSE_BYTES',
        1024 * 1024,
        16_384,
        4 * 1024 * 1024,
      ),
      attempts: 1,
      redirect: 'error',
      userAgent: this.config.get<string>(
        'TRENDS_USER_AGENT',
        'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
      ),
    }) as YouTubeVideoListResponse;

    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.flatMap((item, index) => {
      const videoId = typeof item.id === 'string' && videoIdPattern.test(item.id)
        ? item.id
        : '';
      const title = sanitizePlainText(item.snippet?.title, 180);
      if (!videoId || !title) return [];
      return [{
        source: this.sourceId(region),
        sourceLabel: `YouTube ${youtubeRegionLabels[region]}热门（音乐、电影、游戏）`,
        externalId: videoId,
        title,
        excerpt: '海外视频发现源，待人工审阅',
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        license: 'YouTube Data API v3 mostPopular；仅作发现线索，不保存描述、频道、评论或媒体内容',
        category: this.categoryFor(item.snippet?.categoryId),
        rank: index + 1,
        views: finiteInteger(item.statistics?.viewCount),
        publishedAt: null,
      } satisfies TrendCandidate];
    });
  }

  private categoryFor(value: unknown) {
    const categoryId = typeof value === 'string' ? value : '';
    if (categoryId === '17') return '体育';
    if (categoryId === '25' || categoryId === '27' || categoryId === '29') {
      return '公共议题';
    }
    if (categoryId === '28') return '科技与平台';
    if (categoryId === '26') return '职场与生活';
    if (new Set([
      '1', '10', '18', '20', '23', '24', '30', '31', '32', '33', '34',
      '35', '36', '37', '38', '39', '40', '41', '42', '43', '44',
    ]).has(categoryId)) return '文化娱乐';
    return '社会观察';
  }

  private sourceId(region: YouTubeRegion) {
    return `youtube.most_popular.${region.toLocaleLowerCase('en-US')}`;
  }

  private safeError(error: unknown) {
    const status = error instanceof Error
      ? error.message.match(/\bHTTP\s+(\d{3})\b/)?.[1]
      : undefined;
    return status ? `HTTP ${status} from YouTube API` : 'YouTube API request failed';
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
