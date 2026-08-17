import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TrendCandidate, TrendSource } from '../trends.types';
import { fetchJson, finiteInteger, sanitizePlainText, safeHttpUrl } from '../trend-text';

type WikimediaRanking = {
  article?: unknown;
  rank?: unknown;
  views?: unknown;
};

type WikimediaRankingResponse = {
  items?: Array<{ articles?: WikimediaRanking[] }>;
};

type WikimediaPage = {
  missing?: boolean;
  ns?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  pageprops?: { disambiguation?: string };
};

type WikimediaDetailResponse = {
  query?: {
    pages?: WikimediaPage[];
    normalized?: Array<{ from?: string; to?: string }>;
    redirects?: Array<{ from?: string; to?: string }>;
  };
};

const utilityPrefix = /^(?:main page|special|wikipedia|file|category|portal|template|help|user|talk|mediawiki|draft|module|topic|首页|首頁|特殊|维基百科|維基百科|文件|檔案|分类|分類|主题|主題|模板|帮助|幫助|用户|使用者|讨论|討論):?/i;
const calendarOrListNoise = /^(?:\d{1,4}年|\d{1,2}月\d{1,2}日|list of |lists of |.+列表$|.+名單$)/i;

export function normalizeWikimediaTitle(value: unknown) {
  if (typeof value !== 'string') return '';
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // A malformed percent escape is harmless; keep the original label.
  }
  return sanitizePlainText(decoded.replaceAll('_', ' '), 180);
}

export function isUtilityWikimediaPage(title: string) {
  const normalized = title.trim();
  return (
    !normalized ||
    normalized === '-' ||
    utilityPrefix.test(normalized) ||
    calendarOrListNoise.test(normalized) ||
    /(?:消歧义|消歧義|disambiguation)/i.test(normalized)
  );
}

@Injectable()
export class WikimediaTrendSource implements TrendSource {
  readonly id = 'wikimedia.zh.top';
  readonly label = '维基百科中文站每日热门';
  readonly enabled = true;

  constructor(private readonly config: ConfigService) {}

  async fetch(): Promise<TrendCandidate[]> {
    const rankings = await this.fetchLatestAvailableRanking();
    const limit = this.integerConfig('TRENDS_WIKIMEDIA_LIMIT', 24, 5, 50);
    const filtered = rankings
      .map((item) => ({
        title: normalizeWikimediaTitle(item.article),
        rank: finiteInteger(item.rank),
        views: finiteInteger(item.views),
      }))
      .filter((item) => !isUtilityWikimediaPage(item.title))
      .slice(0, Math.min(60, limit * 2));
    const details = await this.fetchDetails(filtered.map((item) => item.title));

    return filtered.flatMap((item) => {
      const detail = details.get(item.title);
      if (detail?.missing || (detail?.ns !== undefined && detail.ns !== 0)) return [];
      if (detail?.pageprops?.disambiguation !== undefined) return [];
      const title = normalizeWikimediaTitle(detail?.title ?? item.title);
      if (isUtilityWikimediaPage(title)) return [];
      const fallbackUrl = `https://zh.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
      const sourceUrl = safeHttpUrl(detail?.fullurl) ?? fallbackUrl;
      return [{
        source: this.id,
        sourceLabel: this.label,
        externalId: createHash('sha256').update(title.toLocaleLowerCase('zh-CN')).digest('hex'),
        title,
        excerpt: sanitizePlainText(detail?.extract, 500),
        sourceUrl,
        license: 'Wikimedia Analytics；词条摘要 CC BY-SA 4.0（仅作线索并保留来源）',
        category: '知识热榜',
        rank: item.rank,
        views: item.views,
        publishedAt: null,
      } satisfies TrendCandidate];
    }).slice(0, limit);
  }

  private async fetchLatestAvailableRanking() {
    let lastError: unknown;
    for (let daysAgo = 1; daysAgo <= 4; daysAgo += 1) {
      const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      const year = String(date.getUTCFullYear());
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/zh.wikipedia.org/all-access/${year}/${month}/${day}`;
      try {
        const payload = await fetchJson(url, this.requestOptions()) as WikimediaRankingResponse;
        const articles = payload.items?.[0]?.articles;
        if (Array.isArray(articles) && articles.length > 0) return articles;
        lastError = new Error('Wikimedia returned no ranked pages');
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Wikimedia rankings unavailable');
  }

  private async fetchDetails(titles: string[]) {
    const result = new Map<string, WikimediaPage>();
    for (let offset = 0; offset < titles.length; offset += 20) {
      const batch = titles.slice(offset, offset + 20);
      const parameters = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        prop: 'extracts|info|pageprops',
        exintro: '1',
        explaintext: '1',
        inprop: 'url',
        ppprop: 'disambiguation',
        redirects: '1',
        titles: batch.join('|'),
      });
      const payload = await fetchJson(
        `https://zh.wikipedia.org/w/api.php?${parameters.toString()}`,
        this.requestOptions(),
      ) as WikimediaDetailResponse;
      const aliases = new Map<string, string>();
      for (const title of batch) aliases.set(title, title);
      for (const alias of [...(payload.query?.normalized ?? []), ...(payload.query?.redirects ?? [])]) {
        const from = normalizeWikimediaTitle(alias.from);
        const to = normalizeWikimediaTitle(alias.to);
        if (from && to) aliases.set(from, to);
      }
      const pages = new Map<string, WikimediaPage>();
      for (const page of payload.query?.pages ?? []) {
        const title = normalizeWikimediaTitle(page.title);
        if (title) pages.set(title, page);
      }
      for (const requested of batch) {
        let resolved = requested;
        for (let hop = 0; hop < 4; hop += 1) {
          const next = aliases.get(resolved);
          if (!next || next === resolved) break;
          resolved = next;
        }
        const page = pages.get(resolved) ?? pages.get(requested);
        if (page) result.set(requested, page);
      }
    }
    return result;
  }

  private requestOptions() {
    return {
      timeoutMs: this.integerConfig('TRENDS_SOURCE_TIMEOUT_MS', 8_000, 1_000, 30_000),
      maxBytes: this.integerConfig(
        'TRENDS_MAX_RESPONSE_BYTES',
        1024 * 1024,
        16_384,
        4 * 1024 * 1024,
      ),
      userAgent: this.config.get<string>(
        'TRENDS_USER_AGENT',
        'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
      ),
      attempts: 2,
    };
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
