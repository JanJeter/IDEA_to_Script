import { ConfigService } from '@nestjs/config';
import {
  parseQianfanBaiduTabs,
  QianfanBaiduTrendSource,
} from './qianfan-baidu-trend.source';

describe('QianfanBaiduTrendSource', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('accepts only currently documented Baidu hot-search tabs', () => {
    expect(parseQianfanBaiduTabs('livelihood, invalid, movie,livelihood')).toEqual([
      'livelihood',
      'movie',
    ]);
    expect(parseQianfanBaiduTabs(undefined)).toEqual([
      'livelihood',
      'new_entertainment',
      'finance',
    ]);
  });

  it('maps tabs to distinct sources and keeps partial successes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const firstRequestAt = new Map<string, number>();
    const allRequestTimes: number[] = [];
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const tab = new URL(url).searchParams.get('tab') ?? '';
      allRequestTimes.push(Date.now());
      if (!firstRequestAt.has(tab)) firstRequestAt.set(tab, Date.now());
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer secret-key');
      expect(url).toContain('/v2/tools/baidu_trending?tab=');
      expect(url).not.toContain('trending_lists');
      if (url.endsWith('tab=livelihood')) {
        return new Response(JSON.stringify({
          code: '0',
          data: [{
            word: '年轻人开始重新讨论通勤时间',
            desc: '公共讨论集中在工作、时间与生活选择。',
            hotScore: '123456',
            index: 0,
            url: 'https://www.baidu.com/s?wd=example',
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ code: 'upstream_error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const source = new QianfanBaiduTrendSource(new ConfigService({
      TRENDS_QIANFAN_API_KEY: 'secret-key',
      TRENDS_QIANFAN_BAIDU_TABS: 'livelihood,invalid,finance',
      TRENDS_SOURCE_TIMEOUT_MS: '1000',
    }));

    const result = source.fetch();
    await jest.runAllTimersAsync();
    await expect(result).resolves.toEqual([
      expect.objectContaining({
        source: 'qianfan.baidu.livelihood',
        sourceLabel: '百度民生榜（百度千帆）',
        title: '年轻人开始重新讨论通勤时间',
        excerpt: '公共讨论集中在工作、时间与生活选择。',
        views: 123456,
        rank: 1,
      }),
    ]);
    expect(fetchMock.mock.calls.every(([input]) => !String(input).includes('invalid'))).toBe(true);
    expect((firstRequestAt.get('finance') ?? 0) - (firstRequestAt.get('livelihood') ?? 0))
      .toBeGreaterThanOrEqual(1_100);
    expect(allRequestTimes.slice(1).every((time, index) => (
      time - allRequestTimes[index] >= 1_100
    ))).toBe(true);
    expect(source.fetchReport()).toEqual(expect.objectContaining({ degraded: true }));
  });

  it('paces a same-tab retry at least 1100ms after the first 500 response', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const requestTimes: number[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async () => {
      requestTimes.push(Date.now());
      if (requestTimes.length === 1) {
        return new Response(JSON.stringify({ code: 'upstream_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({
        code: '0',
        data: [{
          word: '通勤时间引发新讨论',
          desc: '一条抽象化的社会话题。',
          hotScore: 42,
          index: 0,
          url: 'https://www.baidu.com/s?wd=retry-example',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const source = new QianfanBaiduTrendSource(new ConfigService({
      TRENDS_QIANFAN_API_KEY: 'secret-key',
      TRENDS_QIANFAN_BAIDU_TABS: 'livelihood',
      TRENDS_SOURCE_TIMEOUT_MS: '1000',
    }));

    const result = source.fetch();
    await jest.advanceTimersByTimeAsync(1_099);
    expect(requestTimes).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual([
      expect.objectContaining({ title: '通勤时间引发新讨论' }),
    ]);
    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThanOrEqual(1_100);
  });
});
