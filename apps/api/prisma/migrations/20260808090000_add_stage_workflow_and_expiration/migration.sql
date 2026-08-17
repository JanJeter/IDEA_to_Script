ALTER TYPE "ProjectStatus" ADD VALUE 'REVIEWING';

ALTER TABLE "Project"
ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "regenerationsUsed" INTEGER NOT NULL DEFAULT 0;
UPDATE "Project" SET "expiresAt" = "createdAt" + INTERVAL '7 days';
ALTER TABLE "Project" ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "GenerationVersion"
ADD COLUMN "currentStage" TEXT NOT NULL DEFAULT 'IDEA',
ADD COLUMN "confirmedStage" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "GenerationVersion"
SET
  "currentStage" = CASE
    WHEN "scriptText" IS NOT NULL THEN 'SCRIPT'
    WHEN "writtenScenes" IS NOT NULL THEN 'SCRIPT'
    WHEN "scenePlans" IS NOT NULL THEN 'SCENES'
    WHEN "beats" IS NOT NULL THEN 'BEATS'
    WHEN "locations" IS NOT NULL THEN 'LOCATIONS'
    WHEN "characters" IS NOT NULL THEN 'CHARACTERS'
    WHEN "premise" IS NOT NULL THEN 'PREMISE'
    ELSE 'IDEA'
  END,
  "confirmedStage" = CASE WHEN "status" = 'ACTIVE' THEN 'SCRIPT' ELSE NULL END;

WITH ranked_staging AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "projectId" ORDER BY "createdAt" DESC, "id" DESC) AS rank
  FROM "GenerationVersion"
  WHERE "status" = 'STAGING'
)
UPDATE "GenerationVersion" AS version
SET
  "status" = 'FAILED',
  "completedAt" = CURRENT_TIMESTAMP,
  "error" = COALESCE(version."error", 'Superseded while enabling staged review')
FROM ranked_staging
WHERE version."id" = ranked_staging."id" AND ranked_staging.rank > 1;

ALTER TABLE "GenerationJob"
ADD COLUMN "versionId" TEXT,
ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'PREMISE';

UPDATE "GenerationJob" AS job
SET "versionId" = version."id"
FROM "GenerationVersion" AS version
WHERE version."jobId" = job."id" AND job."versionId" IS NULL;

CREATE INDEX "Project_visitorId_expiresAt_idx" ON "Project"("visitorId", "expiresAt");
CREATE INDEX "Project_expiresAt_idx" ON "Project"("expiresAt");
CREATE UNIQUE INDEX "GenerationVersion_one_staging_per_project"
ON "GenerationVersion"("projectId")
WHERE "status" = 'STAGING';
CREATE INDEX "GenerationJob_versionId_queuedAt_idx" ON "GenerationJob"("versionId", "queuedAt");

ALTER TABLE "GenerationJob"
ADD CONSTRAINT "GenerationJob_versionId_fkey"
FOREIGN KEY ("versionId") REFERENCES "GenerationVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
