export type TrendRiskLevelValue = 'LOW' | 'REVIEW' | 'BLOCKED';
export type TrendPolicyActionValue = 'AUTO_APPROVE' | 'REVIEW' | 'BLOCK';

export type TrendCandidate = {
  source: string;
  sourceLabel: string;
  externalId: string;
  title: string;
  excerpt: string;
  sourceUrl: string;
  license: string;
  category?: string;
  rank: number | null;
  views: number | null;
  publishedAt: Date | null;
};

export type TrendPolicyResult = {
  category: string;
  riskLevel: TrendRiskLevelValue;
  action: TrendPolicyActionValue;
  reasons: string[];
};

export type PublicTrendTopic = {
  id: string;
  title: string;
  excerpt: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  license: string;
  category: string;
  rank: number | null;
  views: number | null;
  heatScore: number;
  momentumScore: number;
  riskLevel: TrendRiskLevelValue;
  riskReasons: string[];
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type TrendSourceStatus = {
  id: string;
  label: string;
  status: 'ok' | 'error';
  message?: string;
  lastSuccessAt: string | null;
  stale: boolean;
  degraded?: boolean;
};

export type TrendSourceFetchReport = {
  message?: string;
  degraded?: boolean;
};

export type TrendSource = {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  fetch(): Promise<TrendCandidate[]>;
  fetchTtlMs?(): number;
  storageSourceIds?(): string[];
  fetchReport?(): TrendSourceFetchReport;
};

export type TrendFeedResponse = {
  items: PublicTrendTopic[];
  refreshedAt: string | null;
  stale: boolean;
  sources: TrendSourceStatus[];
};

export type TrendCreativeBrief = {
  prompt: string;
  creativeKernel: string;
  audienceQuestion: string;
  safetyRules: string[];
  provenance: string[];
};

export type TrendProjectInput = {
  mode: 'TREND_INSPIRED';
  trendTopicId: string;
  title: string;
  logline: string;
  sourceText: string;
  genre: string;
  tone: string;
  targetMinutes: number;
  language: 'zh-CN';
};
