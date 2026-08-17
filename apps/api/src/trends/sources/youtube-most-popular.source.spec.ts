import { ConfigService } from '@nestjs/config';
import {
  parseYouTubeRegions,
  YouTubeMostPopularSource,
} from './youtube-most-popular.source';

describe('YouTubeMostPopularSource', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses overseas defaults and accepts only unique allowlisted regions', () => {
    expect(parseYouTubeRegions(undefined)).toEqual(['US', 'GB']);
    expect(parseYouTubeRegions('us, KR,invalid,US,tw,CN, sg')).toEqual([
      'US',
      'KR',
      'TW',
      'SG',
    ]);
  });

  it('requires an API key plus explicit derivative-use approval and uses an hourly cadence', () => {
    expect(new YouTubeMostPopularSource(new ConfigService()).enabled).toBe(false);
    expect(new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: '  ',
      TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED: 'true',
    })).enabled).toBe(false);
    expect(new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: 'api-key',
    })).enabled).toBe(false);
    const source = new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: 'api-key',
      TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED: 'true',
    }));
    expect(source.enabled).toBe(true);
    expect(source.fetchTtlMs()).toBe(3_600_000);
  });

  it('requests only the minimum official fields and maps no descriptions, channels, or comments', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://www.googleapis.com');
      expect(url.pathname).toBe('/youtube/v3/videos');
      expect(url.searchParams.get('part')).toBe('snippet,statistics');
      expect(url.searchParams.get('fields')).toBe(
        'items(id,snippet(title,categoryId),statistics(viewCount))',
      );
      expect(url.searchParams.get('chart')).toBe('mostPopular');
      expect(url.searchParams.get('regionCode')).toBe('US');
      expect(url.searchParams.get('maxResults')).toBe('2');
      expect(url.searchParams.get('key')).toBe('api-key');
      return new Response(JSON.stringify({
        items: [
          {
            id: 'AbCdEfGhI_1',
            snippet: {
              title: '<b>Film Night</b>\u0000',
              categoryId: '1',
              description: 'must not be retained',
              channelTitle: 'must not be retained',
            },
            statistics: {
              viewCount: '250000',
              commentCount: '999',
            },
          },
          {
            id: '123456789_-',
            snippet: { title: 'Future Tech', categoryId: '28' },
            statistics: { viewCount: 1250 },
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const source = new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: 'api-key',
      TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED: 'true',
      TRENDS_YOUTUBE_REGIONS: 'US',
      TRENDS_YOUTUBE_LIMIT_PER_REGION: '2',
    }));

    const result = await source.fetch();
    expect(result).toEqual([
      expect.objectContaining({
        source: 'youtube.most_popular.us',
        externalId: 'AbCdEfGhI_1',
        title: 'Film Night',
        excerpt: '海外视频发现源，待人工审阅',
        sourceUrl: 'https://www.youtube.com/watch?v=AbCdEfGhI_1',
        category: '文化娱乐',
        views: 250000,
        rank: 1,
        publishedAt: null,
      }),
      expect.objectContaining({
        externalId: '123456789_-',
        title: 'Future Tech',
        category: '科技与平台',
        views: 1250,
        rank: 2,
      }),
    ]);
    for (const candidate of result) {
      expect(candidate).not.toHaveProperty('description');
      expect(candidate).not.toHaveProperty('channelTitle');
      expect(candidate).not.toHaveProperty('commentCount');
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps successful regions and reports a degraded partial fetch', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.searchParams.get('regionCode') === 'US') {
        return new Response(JSON.stringify({
          items: [{
            id: 'AbCdEfGhI_1',
            snippet: { title: 'Global Film Signal', categoryId: '1' },
            statistics: { viewCount: '42' },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: { code: 400 } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const source = new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: 'api-key',
      TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED: 'true',
      TRENDS_YOUTUBE_REGIONS: 'US,GB',
    }));

    await expect(source.fetch()).resolves.toEqual([
      expect.objectContaining({
        source: 'youtube.most_popular.us',
        title: 'Global Film Signal',
      }),
    ]);
    expect(source.storageSourceIds()).toEqual([
      'youtube.most_popular.us',
      'youtube.most_popular.gb',
    ]);
    expect(source.fetchReport()).toEqual(expect.objectContaining({
      degraded: true,
      message: expect.stringContaining('1/2'),
    }));
  });

  it('rejects an empty allowlist without making a request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const source = new YouTubeMostPopularSource(new ConfigService({
      TRENDS_YOUTUBE_API_KEY: 'api-key',
      TRENDS_YOUTUBE_DERIVATIVE_USE_APPROVED: 'true',
      TRENDS_YOUTUBE_REGIONS: 'CN,not-a-region',
    }));

    expect(source.storageSourceIds()).toEqual([]);
    await expect(source.fetch()).rejects.toThrow(
      'TRENDS_YOUTUBE_REGIONS contains no supported region',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
