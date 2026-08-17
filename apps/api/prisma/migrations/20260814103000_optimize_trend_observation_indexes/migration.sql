DROP INDEX IF EXISTS "TrendObservation_trendTopicId_observedAt_idx";

CREATE INDEX "TrendObservation_observedAt_idx" ON "TrendObservation"("observedAt");
