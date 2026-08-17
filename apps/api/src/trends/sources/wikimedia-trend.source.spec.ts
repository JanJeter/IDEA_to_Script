import { ConfigService } from '@nestjs/config';
import {
  isUtilityWikimediaPage,
  normalizeWikimediaTitle,
  WikimediaTrendSource,
} from './wikimedia-trend.source';

describe('WikimediaTrendSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('normalizes encoded titles and filters utility, list, date and disambiguation noise', () => {
    expect(normalizeWikimediaTitle('人工智能_%28电影%29')).toBe('人工智能 (电影)');
    expect(isUtilityWikimediaPage('Main Page')).toBe(true);
    expect(isUtilityWikimediaPage('Special:Search')).toBe(true);
    expect(isUtilityWikimediaPage('2026年')).toBe(true);
    expect(isUtilityWikimediaPage('List of films')).toBe(true);
    expect(isUtilityWikimediaPage('人工智能')).toBe(false);
  });

  it('enriches ranked titles and maps redirects back to the requested title', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/metrics/pageviews/top/')) {
        return new Response(JSON.stringify({
          items: [{ articles: [
            { article: 'AI', rank: 1, views: 100000 },
            { article: 'Main_Page', rank: 2, views: 90000 },
          ] }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      expect(url).toContain('exintro=1');
      return new Response(JSON.stringify({
        query: {
          redirects: [{ from: 'AI', to: '人工智能' }],
          pages: [{
            ns: 0,
            title: '人工智能',
            extract: '<b>人工智能</b> 是研究智能系统的领域。',
            fullurl: 'https://zh.wikipedia.org/wiki/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD',
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const source = new WikimediaTrendSource(new ConfigService({ TRENDS_WIKIMEDIA_LIMIT: '5' }));

    await expect(source.fetch()).resolves.toEqual([
      expect.objectContaining({
        source: 'wikimedia.zh.top',
        sourceLabel: '维基百科中文站每日热门',
        title: '人工智能',
        excerpt: '人工智能 是研究智能系统的领域。',
        rank: 1,
        views: 100000,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
