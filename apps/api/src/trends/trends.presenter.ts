import type { TrendTopic } from '@prisma/client';
import type { PublicTrendTopic, TrendRiskLevelValue } from './trends.types';

export function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function presentTrendTopic(topic: TrendTopic): PublicTrendTopic {
  return {
    id: topic.id,
    title: topic.title,
    excerpt: topic.excerpt,
    source: topic.source,
    sourceLabel: topic.sourceLabel,
    sourceUrl: topic.sourceUrl,
    license: topic.license,
    category: topic.category,
    rank: topic.rank,
    views: topic.views,
    heatScore: Math.round(topic.heatScore),
    momentumScore: Math.round(topic.momentumScore),
    riskLevel: topic.riskLevel as TrendRiskLevelValue,
    riskReasons: stringArray(topic.riskReasons),
    publishedAt: topic.publishedAt?.toISOString() ?? null,
    firstSeenAt: topic.firstSeenAt.toISOString(),
    lastSeenAt: topic.lastSeenAt.toISOString(),
  };
}
