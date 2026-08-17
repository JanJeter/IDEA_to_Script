import { ConfigService } from '@nestjs/config';
import {
  parseWeiboOfficialHotWordResponse,
  WeiboOfficialHotWordSource,
} from './weibo-official-hot-word.source';

describe('WeiboOfficialHotWordSource', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('requires both a non-empty access token and explicit commercial approval', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    expect(new WeiboOfficialHotWordSource(new ConfigService()).enabled).toBe(false);
    expect(new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_ACCESS_TOKEN: 'token-only',
    })).enabled).toBe(false);
    expect(new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'true',
    })).enabled).toBe(false);
    expect(new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_ACCESS_TOKEN: '  token  ',
      TRENDS_WEIBO_COMMERCIAL_APPROVED: ' TRUE ',
    })).enabled).toBe(true);
    expect(new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_APP_KEY: 'contract-app-key',
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'true',
    })).enabled).toBe(true);

    const disabled = new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_ACCESS_TOKEN: 'token-only',
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'false',
    }));
    await expect(disabled.fetch()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a bounded five-minute source cadence', () => {
    expect(new WeiboOfficialHotWordSource(new ConfigService()).fetchTtlMs()).toBe(300_000);
    expect(new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_FETCH_TTL_MS: '1000',
    })).fetchTtlMs()).toBe(300_000);
  });

  it('strictly cleans documented fields, filters pinned id=0 and restricts links', () => {
    const result = parseWeiboOfficialHotWordResponse({
      cat: 'all',
      data: [
        {
          id: 0,
          word: '付费置顶词',
          num: '999999999',
          h5_query_link: 'https://s.weibo.com/weibo?q=promoted',
          flag: '16',
        },
        {
          id: '2',
          word: ' <b>通勤时间</b>\u0000 引发讨论 ',
          num: '123456',
          h5_query_link: 'https://s.weibo.com/weibo/%E9%80%9A%E5%8B%A4',
          app_query_link: 'sinaweibo://searchall?q=ignored',
          user: { id: 'must-not-survive' },
        },
        {
          id: 3,
          word: '消费选择变化',
          num: 654321,
          h5_query_link: 'https://evilweibo.com/steal',
        },
        {
          id: 4,
          word: '工作方式变化',
          num: '42',
          h5_query_link: 'http://s.weibo.com/weibo?q=insecure',
        },
        { id: '4.5', word: '错误排名', num: '10' },
        { id: 5, word: '错误热度', num: 'not-a-number' },
        { id: 6, word: '', num: '10' },
      ],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(expect.objectContaining({
      source: 'weibo.official.hot_word',
      sourceLabel: '微博官方商业热搜榜',
      title: '通勤时间 引发讨论',
      excerpt: '',
      rank: 2,
      views: 123456,
      publishedAt: null,
    }));
    expect(new URL(result[0].sourceUrl).hostname).toBe('s.weibo.com');

    const fallback = new URL(result[1].sourceUrl);
    expect(fallback.origin).toBe('https://s.weibo.com');
    expect(fallback.pathname).toBe('/weibo');
    expect(fallback.searchParams.get('q')).toBe('消费选择变化');
    expect(new URL(result[2].sourceUrl).protocol).toBe('https:');

    for (const item of result) {
      expect(item).not.toHaveProperty('flag');
      expect(item).not.toHaveProperty('app_query_link');
      expect(item).not.toHaveProperty('user');
      expect(item).not.toHaveProperty('id');
      expect(item).not.toHaveProperty('num');
      expect(item).not.toHaveProperty('h5_query_link');
    }
  });

  it('uses the official endpoint, caps count at 50 and forbids redirects', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      async (input, init) => {
        const url = new URL(String(input));
        expect(url.origin).toBe('https://c.api.weibo.com');
        expect(url.pathname).toBe('/2/search/hot_word/biz.json');
        expect(url.searchParams.get('access_token')).toBe('token&with=symbols');
        expect(url.searchParams.get('count')).toBe('50');
        expect(init?.redirect).toBe('error');
        expect(init?.signal).toBeDefined();
        return new Response(JSON.stringify({
          data: [{
            id: '1',
            word: '今日社会观察',
            num: '88',
            h5_query_link: 'https://weibo.com/search?q=example',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    );
    const source = new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_ACCESS_TOKEN: 'token&with=symbols',
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'true',
      TRENDS_WEIBO_COUNT: '500',
    }));

    await expect(source.fetch()).resolves.toEqual([
      expect.objectContaining({
        source: 'weibo.official.hot_word',
        title: '今日社会观察',
        rank: 1,
        views: 88,
      }),
    ]);
    expect(source.storageSourceIds()).toEqual(['weibo.official.hot_word']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('prefers the contract AppKey source mode over an OAuth token', async () => {
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('source')).toBe('contract-app-key');
      expect(url.searchParams.has('access_token')).toBe(false);
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const source = new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_APP_KEY: 'contract-app-key',
      TRENDS_WEIBO_ACCESS_TOKEN: 'oauth-fallback',
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'true',
    }));

    await expect(source.fetch()).resolves.toEqual([]);
  });

  it('retries transient failures and never exposes the token or full URL', async () => {
    jest.useFakeTimers();
    const secret = 'very-secret-access-token';
    const endpoint = 'https://c.api.weibo.com/2/search/hot_word/biz.json';
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(
      async (input) => {
        throw new Error(`network failed for ${String(input)}`);
      },
    );
    const source = new WeiboOfficialHotWordSource(new ConfigService({
      TRENDS_WEIBO_ACCESS_TOKEN: secret,
      TRENDS_WEIBO_COMMERCIAL_APPROVED: 'true',
    }));

    const failure: Promise<Error> = source.fetch().then(
      () => {
        throw new Error('Expected Weibo request to fail');
      },
      (error: unknown) => error instanceof Error
        ? error
        : new Error('Unexpected non-error rejection'),
    );
    await jest.advanceTimersByTimeAsync(250);
    const error = await failure;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(error.message).toBe('Weibo official hot-word request failed');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain(endpoint);
    expect(error.message).not.toContain('access_token');
  });

  it('rejects a malformed root response instead of recording a false empty snapshot', () => {
    expect(() => parseWeiboOfficialHotWordResponse({ data: null })).toThrow(
      'Invalid Weibo official hot-word response',
    );
    expect(() => parseWeiboOfficialHotWordResponse([])).toThrow(
      'Invalid Weibo official hot-word response',
    );
  });
});
