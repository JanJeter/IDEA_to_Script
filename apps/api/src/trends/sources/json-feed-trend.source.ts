import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TrendCandidate, TrendSource } from '../trends.types';
import {
  fetchJson,
  finiteInteger,
  isPrivateOrReservedAddress,
  safeDate,
  safePublicSourceUrl,
  sanitizePlainText,
} from '../trend-text';

type JsonFeedItem = {
  id?: unknown;
  externalId?: unknown;
  title?: unknown;
  excerpt?: unknown;
  url?: unknown;
  sourceUrl?: unknown;
  source?: unknown;
  sourceLabel?: unknown;
  license?: unknown;
  category?: unknown;
  rank?: unknown;
  views?: unknown;
  publishedAt?: unknown;
};

@Injectable()
export class JsonFeedTrendSource implements TrendSource {
  readonly id = 'normalized-json-feed';
  readonly label = '配置的标准化 JSON 信号源';

  constructor(private readonly config: ConfigService) {}

  get enabled() {
    return Boolean(this.config.get<string>('TRENDS_JSON_FEED_URL', '').trim());
  }

  async fetch(): Promise<TrendCandidate[]> {
    const feedUrl = this.config.get<string>('TRENDS_JSON_FEED_URL', '').trim();
    if (!feedUrl) return [];
    await this.assertSafeFeedUrl(feedUrl);
    const timeoutMs = this.integerConfig('TRENDS_SOURCE_TIMEOUT_MS', 8_000, 1_000, 30_000);
    const maxBytes = this.integerConfig(
      'TRENDS_MAX_RESPONSE_BYTES',
      1024 * 1024,
      16_384,
      4 * 1024 * 1024,
    );
    const userAgent = this.config.get<string>(
      'TRENDS_USER_AGENT',
      'AIScriptTrendBot/0.1 (Idea2Screenplay; local development)',
    );
    const payload = await fetchJson(feedUrl, {
      timeoutMs,
      userAgent,
      attempts: 2,
      redirect: 'error',
      maxBytes,
    });
    const rawItems = Array.isArray(payload)
      ? payload
      : this.isRecord(payload) && Array.isArray(payload.items)
        ? payload.items
        : [];
    const limit = this.integerConfig('TRENDS_JSON_FEED_LIMIT', 30, 1, 100);
    return rawItems.flatMap((raw) => this.toCandidate(raw)).slice(0, limit);
  }

  private toCandidate(raw: unknown): TrendCandidate[] {
    if (!this.isRecord(raw)) return [];
    const item = raw as JsonFeedItem;
    const title = sanitizePlainText(item.title, 180);
    const sourceUrl = safePublicSourceUrl(item.sourceUrl ?? item.url);
    if (!title || !sourceUrl) return [];
    const sourceName = sanitizePlainText(item.source, 60) || 'custom';
    const idInput = sanitizePlainText(item.id ?? item.externalId, 200) || `${sourceUrl}:${title}`;
    const externalId = createHash('sha256').update(idInput).digest('hex');
    return [{
      source: `json:${sourceName}`,
      sourceLabel: sanitizePlainText(item.sourceLabel, 80) || sourceName,
      externalId,
      title,
      // Deliberately read only excerpt. Fields such as body, comments and account are ignored.
      excerpt: sanitizePlainText(item.excerpt, 500),
      sourceUrl,
      license: sanitizePlainText(item.license, 120) || '来源许可未声明；仅作事实线索',
      category: sanitizePlainText(item.category, 40) || undefined,
      rank: finiteInteger(item.rank),
      views: finiteInteger(item.views),
      publishedAt: safeDate(item.publishedAt),
    }];
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private async assertSafeFeedUrl(value: string) {
    const url = new URL(value);
    const developmentOverride =
      this.config.get<string>('NODE_ENV', 'development') !== 'production' &&
      this.config.get<string>('TRENDS_ALLOW_PRIVATE_JSON_FEED', 'false') === 'true';
    if (url.username || url.password) throw new Error('JSON trend feed URL must not contain credentials');
    if (!developmentOverride && url.protocol !== 'https:') {
      throw new Error('JSON trend feed URL must use HTTPS');
    }
    if (developmentOverride && url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('JSON trend feed URL must use HTTP or HTTPS');
    }
    if (developmentOverride) return;

    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new Error('JSON trend feed URL points to a local host');
    }
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateOrReservedAddress(address))) {
      throw new Error('JSON trend feed URL must resolve only to public addresses');
    }
  }

  private integerConfig(key: string, fallback: number, min: number, max: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value)) return fallback;
    return Math.min(max, Math.max(min, value));
  }
}
