CREATE TYPE "GenerationVersionStatus" AS ENUM ('STAGING', 'ACTIVE', 'SUPERSEDED', 'FAILED');

CREATE TABLE "GenerationVersion" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "status" "GenerationVersionStatus" NOT NULL DEFAULT 'STAGING',
  "title" TEXT,
  "premise" TEXT,
  "synopsis" TEXT,
  "theme" TEXT,
  "characters" JSONB,
  "locations" JSONB,
  "beats" JSONB,
  "scenePlans" JSONB,
  "writtenScenes" JSONB,
  "scriptText" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "GenerationVersion_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Project" ADD COLUMN "activeVersionId" TEXT;
ALTER TABLE "GenerationRun" ADD COLUMN "versionId" TEXT;

CREATE UNIQUE INDEX "Project_activeVersionId_key" ON "Project"("activeVersionId");
CREATE INDEX "GenerationVersion_projectId_createdAt_idx" ON "GenerationVersion"("projectId", "createdAt");
CREATE INDEX "GenerationVersion_projectId_status_idx" ON "GenerationVersion"("projectId", "status");
CREATE INDEX "GenerationRun_versionId_startedAt_idx" ON "GenerationRun"("versionId", "startedAt");

ALTER TABLE "GenerationVersion"
ADD CONSTRAINT "GenerationVersion_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Project"
ADD CONSTRAINT "Project_activeVersionId_fkey"
FOREIGN KEY ("activeVersionId") REFERENCES "GenerationVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GenerationRun"
ADD CONSTRAINT "GenerationRun_versionId_fkey"
FOREIGN KEY ("versionId") REFERENCES "GenerationVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
