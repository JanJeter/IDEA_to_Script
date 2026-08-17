import { ConfigService } from '@nestjs/config';
import { parseXWoeids, XWoeidTrendSource } from './x-woeid-trend.source';

describe('XWoeidTrendSource', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses documented defaults and accepts only unique official WOEIDs', () => {
    expect(parseXWoeids(undefined)).toEqual(['23424977', '23424975']);
    expect(parseXWoeids(
      '1, 23424975,invalid,2459115,1,23424948,44418,1118370',
    )).toEqual(['1', '23424975', '2459115', '44418', '1118370']);
  });

  it('uses a bounded 30-minute per-source cadence by default', () => {
    expect(new XWoeidTrendSource(new ConfigService()).fetchTtlMs()).toBe(1_800_000);
    expect(new XWoeidTrendSource(new ConfigService({
      TRENDS_X_FETCH_TTL_MS: '60000',
    })).fetchTtlMs()).toBe(900_000);
  });

  it('requires both a non-empty bearer token and approved X use case', () => {
    expect(new XWoeidTrendSource(new ConfigService()).enabled).toBe(false);
    expect(new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: '  ',
    })).enabled).toBe(false);
    expect(new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
    })).enabled).toBe(false);
    expect(new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
      TRENDS_X_USE_CASE_APPROVED: 'true',
    })).enabled).toBe(true);
  });

  it('calls the official endpoint and maps safe trend fields without posts or accounts', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.x.com');
      expect(url.pathname).toBe('/2/trends/by/woeid/1');
      expect(url.searchParams.get('max_trends')).toBe('20');
      expect(url.searchParams.get('trend.fields')).toBe('trend_name,tweet_count');
      expect((init?.headers as Record<string, string>).Authorization)
        .toBe('Bearer secret-token');
      return new Response(JSON.stringify({
        data: [
          { trend_name: '<b>#AI</b>\u0000 now', tweet_count: '250000' },
          { trend_name: 'Film Night', post_count: 1250 },
          { trend_name: '', tweet_count: 99 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const source = new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
      TRENDS_X_USE_CASE_APPROVED: 'true',
      TRENDS_X_WOEIDS: '1',
    }));

    const result = await source.fetch();
    expect(result).toEqual([
      expect.objectContaining({
        source: 'x.woeid.1',
        sourceLabel: 'X 全球趋势',
        title: '#AI now',
        excerpt: '海外多语言趋势，待人工审阅',
        views: 250000,
        rank: 1,
      }),
      expect.objectContaining({
        source: 'x.woeid.1',
        title: 'Film Night',
        views: 1250,
        rank: 2,
      }),
    ]);
    const sourceUrl = new URL(result[0].sourceUrl);
    expect(sourceUrl.origin).toBe('https://x.com');
    expect(sourceUrl.pathname).toBe('/search');
    expect(sourceUrl.searchParams.get('q')).toBe('#AI now');
    expect(result[0]).not.toHaveProperty('text');
    expect(result[0]).not.toHaveProperty('author_id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps successful regions and reports a degraded partial fetch', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/1')) {
        return new Response(JSON.stringify({
          data: [{ trend_name: 'Global Signal', tweet_count: 42 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ errors: [{ title: 'Unavailable' }] }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const source = new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
      TRENDS_X_USE_CASE_APPROVED: 'true',
      TRENDS_X_WOEIDS: '1,23424977',
    }));

    await expect(source.fetch()).resolves.toEqual([
      expect.objectContaining({ source: 'x.woeid.1', title: 'Global Signal' }),
    ]);
    expect(source.storageSourceIds()).toEqual(['x.woeid.1', 'x.woeid.23424977']);
    expect(source.fetchReport()).toEqual(expect.objectContaining({
      degraded: true,
      message: expect.stringContaining('1/2'),
    }));
  });

  it('does not retry inside an X rate-limit window and honors x-rate-limit-reset', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const requestTimes: number[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      requestTimes.push(Date.now());
      if (requestTimes.length === 1) {
        return new Response('', {
          status: 429,
          headers: { 'x-rate-limit-reset': String(Date.now() / 1000 + 2) },
        });
      }
      return new Response(JSON.stringify({
        data: [{ trend_name: 'Recovered Trend', tweet_count: '9' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const source = new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
      TRENDS_X_USE_CASE_APPROVED: 'true',
      TRENDS_X_WOEIDS: '1',
    }));

    await expect(source.fetch()).rejects.toThrow('All configured X WOEID');
    expect(requestTimes).toHaveLength(1);
    await expect(source.fetch()).rejects.toThrow('rate-limit window');
    expect(requestTimes).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(source.fetch()).resolves.toEqual([
      expect.objectContaining({ title: 'Recovered Trend', views: 9 }),
    ]);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(2_000);
  });

  it('rejects a configuration containing no official WOEID without a request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const source = new XWoeidTrendSource(new ConfigService({
      TRENDS_X_BEARER_TOKEN: 'secret-token',
      TRENDS_X_USE_CASE_APPROVED: 'true',
      TRENDS_X_WOEIDS: '23424948,not-a-number,99999999',
    }));

    expect(source.storageSourceIds()).toEqual([]);
    await expect(source.fetch()).rejects.toThrow(
      'TRENDS_X_WOEIDS contains no officially documented WOEID',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
