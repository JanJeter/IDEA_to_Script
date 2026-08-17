import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import type { TrendBriefResponse, TrendFeed } from '../types';
import { TrendRadar } from './TrendRadar';

vi.mock('../api', () => ({
  api: {
    listTrends: vi.fn(),
    refreshTrends: vi.fn(),
    getTrendBrief: vi.fn(),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const topic = {
  id: 'trend-1',
  title: '旧物修复突然受到关注',
  excerpt: '越来越多人开始修复家中留存多年的旧物。',
  source: 'wikimedia',
  sourceLabel: '维基公共关注',
  sourceUrl: 'https://zh.wikipedia.org/wiki/example',
  license: 'CC BY-SA',
  category: '生活方式',
  rank: 3,
  views: 126000,
  heatScore: 82,
  momentumScore: 4,
  riskLevel: 'LOW' as const,
  riskReasons: [],
  publishedAt: null,
  firstSeenAt: '2026-08-14T01:00:00.000Z',
  lastSeenAt: '2026-08-14T02:00:00.000Z',
};

const feed: TrendFeed = {
  items: [topic],
  refreshedAt: '2026-08-14T02:00:00.000Z',
  stale: false,
  sources: [{
    id: 'wikimedia',
    label: '维基公共关注',
    status: 'ok',
    lastSuccessAt: '2026-08-14T02:00:00.000Z',
    stale: false,
  }],
};

const brief: TrendBriefResponse = {
  topic,
  brief: {
    prompt: '创作一部关于修复与告别的完全虚构短剧。',
    creativeKernel: '人保存旧物，究竟是在保存记忆，还是逃避告别？',
    audienceQuestion: '修好一件东西，是否也能修好一段关系？',
    safetyRules: ['不使用现实人物姓名', '改变人物、地点、时间与因果链'],
    provenance: ['维基公共关注'],
  },
  projectInput: {
    mode: 'TREND_INSPIRED',
    trendTopicId: 'trend-1',
    title: '修补期限',
    logline: '一名旧物修复师必须在关店前修好一只拒绝被取走的旧钟。',
    sourceText: '公开信号只作为创作灵感。',
    genre: '现实剧情',
    tone: '克制、温暖，结尾留有余韵',
    targetMinutes: 8,
    language: 'zh-CN',
  },
};

describe('TrendRadar', () => {
  it('renders traceable public signals and opens the AIScript brief', async () => {
    vi.mocked(api.listTrends).mockResolvedValue(feed);
    vi.mocked(api.getTrendBrief).mockResolvedValue(brief);
    const onUseTrend = vi.fn();

    render(<TrendRadar onHome={vi.fn()} onUseTrend={onUseTrend} />);

    expect(await screen.findByRole('heading', { name: '旧物修复突然受到关注' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /核对原始信号/ })).toHaveAttribute('href', topic.sourceUrl);

    fireEvent.click(screen.getByRole('button', { name: /转成短剧/ }));
    expect(await screen.findByRole('heading', { name: '把注意力，改写成人物的选择。' })).toBeInTheDocument();
    expect(screen.getByText('《修补期限》')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /建立短剧项目/ }));
    await waitFor(() => expect(onUseTrend).toHaveBeenCalledWith(brief));
  });
});
