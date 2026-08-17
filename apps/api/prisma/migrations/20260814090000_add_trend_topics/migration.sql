ALTER TYPE "ProjectMode" ADD VALUE 'TREND_INSPIRED';

CREATE TYPE "TrendRiskLevel" AS ENUM ('LOW', 'REVIEW', 'BLOCKED');
CREATE TYPE "TrendPolicyAction" AS ENUM ('AUTO_APPROVE', 'REVIEW', 'BLOCK');

ALTER TABLE "Project" ADD COLUMN "trendTopicId" TEXT;

CREATE TABLE "TrendTopic" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" VARCHAR(500) NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rank" INTEGER,
    "views" INTEGER,
    "heatScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "momentumScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "riskLevel" "TrendRiskLevel" NOT NULL DEFAULT 'LOW',
    "policyAction" "TrendPolicyAction" NOT NULL DEFAULT 'AUTO_APPROVE',
    "riskReasons" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrendObservation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "trendTopicId" TEXT NOT NULL,
    "rank" INTEGER,
    "views" INTEGER,
    "heatScore" DOUBLE PRECISION NOT NULL,
    "momentumScore" DOUBLE PRECISION NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrendTopic_source_externalId_key" ON "TrendTopic"("source", "externalId");
CREATE INDEX "TrendTopic_riskLevel_heatScore_idx" ON "TrendTopic"("riskLevel", "heatScore");
CREATE INDEX "TrendTopic_lastSeenAt_idx" ON "TrendTopic"("lastSeenAt");
CREATE INDEX "Project_trendTopicId_idx" ON "Project"("trendTopicId");
CREATE INDEX "TrendObservation_trendTopicId_observedAt_idx" ON "TrendObservation"("trendTopicId", "observedAt");
CREATE UNIQUE INDEX "TrendObservation_trendTopicId_observedAt_key" ON "TrendObservation"("trendTopicId", "observedAt");

ALTER TABLE "Project" ADD CONSTRAINT "Project_trendTopicId_fkey"
FOREIGN KEY ("trendTopicId") REFERENCES "TrendTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TrendObservation" ADD CONSTRAINT "TrendObservation_trendTopicId_fkey"
FOREIGN KEY ("trendTopicId") REFERENCES "TrendTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
