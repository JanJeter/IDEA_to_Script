import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TrendCandidate, TrendSource } from '../trends.types';
import {
  fetchJson,
  finiteInteger,
  safePublicSourceUrl,
  sanitizePlainText,
} from '../trend-text';

const tabDefinitions = {
  livelihood: '民生榜',
  finance: '财经榜',
  sports: '体育榜',
  new_entertainment: '文娱榜',
  internation_news: '国际榜',
  challenge: '挑战榜',
  movie: '电影榜',
  teleplay: '电视剧榜',
  novel: '小说榜',
} as const;

type QianfanBaiduTab = keyof typeof tabDefinitions;
type QianfanBaiduItem = {
  desc?: unknown;
  hotChange?: unknown;
  hotScore?: unknown;
  index?: unknown;
  query?: unknown;
  url?: unknown;
  word?: unknown;
};
type QianfanBaiduResponse = {
  code?: unknown;
  message?: unknown;
  data?: QianfanBaiduItem[];
};

const QIANFAN_MIN_REQUEST_INTERVAL_MS = 1_100;
const QIANFAN_REQUEST_ATTEMPTS = 2;

export function parseQianfanBaiduTabs(value: string | undefined): QianfanBaiduTab[] {
  const configured = value?.trim()
    ? value.split(',')
    : ['livelihood', 'new_entertainment', 'finance'];
  return [...new Set(configured.map((item) => item.trim()))]
    .filter((item): item is QianfanBaiduTab => item in tabDefinitions);
}

@Injectable()
export class QianfanBaiduTrendSource implements TrendSource {
  readonly id = 'qianfan.baidu';
  readonly label = '百度千帆·百度热搜分类榜';
  private readonly logger = new Logger(QianfanBaiduTrendSource.name);
  private report: { message?: string; degraded?: boolean } = {};
  private requestPaceQueue = Promise.resolve();
  private lastRequestStartedAt = Number.NEGATIVE_INFINITY;
  private nextRequestNotBeforeAt = 0;

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.config.get<string>('TRENDS_QIANFAN_API_KEY', '').trim());
  }

  storageSourceIds() {
    return this.configuredTabs().map((tab) => `qianfan.baidu.${tab}`);
  }

  fetchReport() {
    return this.report;
  }

  async fetch(): Promise<TrendCandidate[]> {
    const apiKey = this.config.get<string>('TRENDS_QIANFAN_API_KEY', '').trim();
    if (!apiKey) return [];
    const tabs = this.configuredTabs();
    if (tabs.length === 0) {
      throw new Error('TRENDS_QIANFAN_BAIDU_TABS contains no supported tab');
    }

    const candidates: TrendCandidate[] = [];
    let successfulTabs = 0;
    const failedTabs: QianfanBaiduTab[] = [];
    for (const tab of tabs) {
      try {
        const items = await this.fetchTab(tab, apiKey);
        successfulTabs += 1;
        candidates.push(...items);
      } catch (error) {
        failedTabs.push(tab);
        this.logger.warn(`Qianfan Baidu tab ${tab} failed: ${this.safeError(error)}`);
      }
    }
    if (successfulTabs === 0) throw new Error('All configured Qianfan Baidu tabs failed');
    this.report = failedTabs.length > 0
      ? {
          degraded: true,
          message: `同步 ${successfulTabs}/${tabs.length} 张榜；${failedTabs.map((tab) => tabDefinitions[tab]).join('、')}沿用最近成功快照`,
        }
      : { degraded: false, message: `同步 ${successfulTabs} 张百度分类榜` };
    return candidates;
  }

  private configuredTabs() {
    return parseQianfanBaiduTabs(
      this.config.get<string>('TRENDS_QIANFAN_BAIDU_TABS'),
    );
  }

  private async fetchTab(tab: QianfanBaiduTab, apiKey: string) {
    const timeoutMs = this.integerConfig('TRENDS_SOURCE_TIMEOUT_MS', 8_000, 1_000, 30_000);
    const maxBytes = this.integerConfig(
      'TRENDS_MAX_RESPONSE_BYTES',
      1024 * 1024,
      16_384,
      4 * 1024 * 1024,
    );
    const url = `https://qianfan.baidubce.com/v2/tools/baidu_trending?tab=${tab}`;
    const options = {
      timeoutMs,
      maxBytes,
      attempts: 1,
      userAgent: this.config.get<string>(
        'TRENDS_USER_AGENT',
        'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
      ),
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: 'error' as const,
    };
    let payload: QianfanBaiduResponse | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < QIANFAN_REQUEST_ATTEMPTS; attempt += 1) {
      await this.waitForRequestSlot();
      try {
        payload = await fetchJson(url, options) as QianfanBaiduResponse;
        break;
      } catch (error) {
        lastError = error;
        if (attempt + 1 >= QIANFAN_REQUEST_ATTEMPTS || !this.isRetryable(error)) {
          throw error;
        }
        this.applyRetryAfter(error);
      }
    }
    if (!payload) {
      throw lastError instanceof Error ? lastError : new Error('Qianfan request failed');
    }
    if (payload.code !== undefined && String(payload.code) !== '0') {
      throw new Error(`Qianfan Baidu returned status ${String(payload.code)}`);
    }

    const items = Array.isArray(payload.data) ? payload.data : [];
    const limit = this.integerConfig('TRENDS_QIANFAN_LIMIT_PER_TAB', 15, 1, 50);
    return items.flatMap((item, arrayIndex) => {
      const title = sanitizePlainText(item.word ?? item.query, 180);
      const sourceUrl = safePublicSourceUrl(item.url);
      if (!title || !sourceUrl) return [];
      const externalId = createHash('sha256')
        .update(`${tab}:${sourceUrl}:${title}`)
        .digest('hex');
      const zeroBasedIndex = finiteInteger(item.index);
      return [{
        source: `qianfan.baidu.${tab}`,
        sourceLabel: `百度${tabDefinitions[tab]}（百度千帆）`,
        externalId,
        title,
        excerpt: sanitizePlainText(item.desc, 500),
        sourceUrl,
        license: '百度千帆·百度热搜；仅保存关键词、短描述、公开热度和来源链接',
        category: this.categoryFor(tab),
        rank: zeroBasedIndex === null ? arrayIndex + 1 : zeroBasedIndex + 1,
        views: finiteInteger(item.hotScore),
        publishedAt: null,
      } satisfies TrendCandidate];
    }).slice(0, limit);
  }

  private categoryFor(tab: QianfanBaiduTab) {
    if (tab === 'sports') return '体育';
    if (tab === 'new_entertainment' || tab === 'movie' || tab === 'teleplay') return '文化娱乐';
    if (tab === 'finance') return '财经观察';
    if (tab === 'livelihood') return '公共议题';
    return undefined;
  }

  private safeError(error: unknown) {
    return error instanceof Error ? error.message.slice(0, 160) : 'tab unavailable';
  }

  /**
   * Every HTTP attempt, including retries and requests from concurrent fetches,
   * passes through this shared queue. Qianfan documents a 1 QPS limit; the
   * extra 100 ms avoids boundary jitter.
   */
  private async waitForRequestSlot() {
    const previous = this.requestPaceQueue;
    let release!: () => void;
    this.requestPaceQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      while (true) {
        const earliestStart = Math.max(
          this.lastRequestStartedAt + QIANFAN_MIN_REQUEST_INTERVAL_MS,
          this.nextRequestNotBeforeAt,
        );
        const remainingMs = earliestStart - Date.now();
        if (remainingMs <= 0) break;
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
      this.lastRequestStartedAt = Date.now();
    } finally {
      release();
    }
  }

  private isRetryable(error: unknown) {
    return !(error instanceof Error)
      || (error as Error & { retryable?: boolean }).retryable !== false;
  }

  private applyRetryAfter(error: unknown) {
    const requestedDelay = error instanceof Error
      ? (error as Error & { retryAfterMs?: number }).retryAfterMs
      : undefined;
    if (requestedDelay === undefined || !Number.isFinite(requestedDelay)) return;
    this.nextRequestNotBeforeAt = Math.max(
      this.nextRequestNotBeforeAt,
      Date.now() + Math.min(30_000, Math.max(0, requestedDelay)),
    );
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
