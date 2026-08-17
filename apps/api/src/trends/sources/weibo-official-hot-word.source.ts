import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TrendCandidate, TrendSource } from '../trends.types';
import { fetchJson, sanitizePlainText } from '../trend-text';

const WEIBO_HOT_WORD_ENDPOINT =
  'https://c.api.weibo.com/2/search/hot_word/biz.json';
const WEIBO_SOURCE_ID = 'weibo.official.hot_word';
const WEIBO_DEFAULT_COUNT = 50;
const WEIBO_MAX_COUNT = 50;
const WEIBO_REQUEST_ATTEMPTS = 2;
const MAX_DATABASE_INTEGER = 2_147_483_647;

type WeiboHotWordItem = {
  id?: unknown;
  word?: unknown;
  num?: unknown;
  h5_query_link?: unknown;
};

type WeiboHotWordResponse = {
  data?: unknown;
};

/**
 * Parse only the aggregate fields documented for Weibo's commercial hot-word
 * endpoint. Raw posts, users, flags, deep links and other response fields are
 * intentionally ignored.
 */
export function parseWeiboOfficialHotWordResponse(
  payload: unknown,
  requestedCount = WEIBO_DEFAULT_COUNT,
): TrendCandidate[] {
  if (!isRecord(payload) || !Array.isArray((payload as WeiboHotWordResponse).data)) {
    throw new Error('Invalid Weibo official hot-word response');
  }

  const limit = clampCount(requestedCount);
  const seenWords = new Set<string>();
  const candidates: TrendCandidate[] = [];

  for (const rawItem of (payload as WeiboHotWordResponse).data as unknown[]) {
    if (!isRecord(rawItem)) continue;
    const item = rawItem as WeiboHotWordItem;
    const rank = strictUnsignedInteger(item.id, false);
    // The official documentation defines id=0 as a pinned item. It is not an
    // organic rank and may be a commercial promotion, so never admit it.
    if (rank === null || rank === 0) continue;

    const title = sanitizePlainText(item.word, 180);
    const views = strictUnsignedInteger(item.num, true);
    if (!title || views === null) continue;

    const dedupeKey = title.toLocaleLowerCase('zh-CN');
    if (seenWords.has(dedupeKey)) continue;
    seenWords.add(dedupeKey);

    candidates.push({
      source: WEIBO_SOURCE_ID,
      sourceLabel: '微博官方商业热搜榜',
      externalId: createHash('sha256').update(dedupeKey).digest('hex'),
      title,
      excerpt: '',
      sourceUrl: weiboSourceUrl(item.h5_query_link, title),
      license: '微博商业数据 API；仅保存热词、公开热度、自然排名和官方来源链接',
      category: '社会观察',
      rank,
      views,
      publishedAt: null,
    } satisfies TrendCandidate);

    if (candidates.length >= limit) break;
  }

  return candidates;
}

@Injectable()
export class WeiboOfficialHotWordSource implements TrendSource {
  readonly id = WEIBO_SOURCE_ID;
  readonly label = '微博官方商业热搜榜';

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.credential()) && this.commercialApproved();
  }

  storageSourceIds() {
    return [this.id];
  }

  fetchTtlMs() {
    return this.integerConfig(
      'TRENDS_WEIBO_FETCH_TTL_MS',
      5 * 60 * 1000,
      5 * 60 * 1000,
      24 * 60 * 60 * 1000,
    );
  }

  async fetch(): Promise<TrendCandidate[]> {
    const credential = this.credential();
    if (!credential || !this.commercialApproved()) return [];

    const count = this.configuredCount();
    const url = new URL(WEIBO_HOT_WORD_ENDPOINT);
    url.searchParams.set(credential.parameter, credential.value);
    url.searchParams.set('count', String(count));

    try {
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
        attempts: WEIBO_REQUEST_ATTEMPTS,
        redirect: 'error',
        userAgent: this.config.get<string>(
          'TRENDS_USER_AGENT',
          'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
        ),
      });
      return parseWeiboOfficialHotWordResponse(payload, count);
    } catch (error) {
      throw this.publicRequestError(error);
    }
  }

  private credential() {
    const appKey = this.config.get<string>('TRENDS_WEIBO_APP_KEY', '').trim();
    if (appKey) return { parameter: 'source', value: appKey } as const;
    const accessToken = this.config.get<string>('TRENDS_WEIBO_ACCESS_TOKEN', '').trim();
    return accessToken
      ? { parameter: 'access_token', value: accessToken } as const
      : null;
  }

  private commercialApproved() {
    const configured = this.config.get<unknown>(
      'TRENDS_WEIBO_COMMERCIAL_APPROVED',
    );
    return configured === true
      || (typeof configured === 'string'
        && configured.trim().toLocaleLowerCase('en-US') === 'true');
  }

  private configuredCount() {
    const explicitCount = this.config.get<unknown>('TRENDS_WEIBO_COUNT');
    const legacyLimit = this.config.get<unknown>('TRENDS_WEIBO_LIMIT');
    return clampCount(explicitCount ?? legacyLimit ?? WEIBO_DEFAULT_COUNT);
  }

  private publicRequestError(error: unknown) {
    const status = error instanceof Error
      ? error.message.match(/\bHTTP\s+(\d{3})\b/)?.[1]
      : undefined;
    return new Error(
      status
        ? `Weibo official hot-word request failed (HTTP ${status})`
        : 'Weibo official hot-word request failed',
    );
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<unknown>(key) ?? fallback);
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}

function weiboSourceUrl(value: unknown, title: string) {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLocaleLowerCase('en-US');
      const officialHostname = hostname === 'weibo.com'
        || hostname.endsWith('.weibo.com');
      if (
        url.protocol === 'https:'
        && !url.username
        && !url.password
        && officialHostname
      ) {
        return url.toString();
      }
    } catch {
      // Fall through to the canonical official search URL.
    }
  }

  const fallback = new URL('https://s.weibo.com/weibo');
  fallback.searchParams.set('q', title);
  return fallback.toString();
}

function strictUnsignedInteger(value: unknown, clampToDatabaseRange: boolean) {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim())) {
    parsed = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  if (parsed > MAX_DATABASE_INTEGER) {
    return clampToDatabaseRange ? MAX_DATABASE_INTEGER : null;
  }
  return parsed;
}

function clampCount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return WEIBO_DEFAULT_COUNT;
  return Math.min(WEIBO_MAX_COUNT, Math.max(1, parsed));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
