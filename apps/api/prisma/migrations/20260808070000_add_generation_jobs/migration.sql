CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'RETRYING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "GenerationJob" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "currentStage" TEXT,
  "message" TEXT NOT NULL DEFAULT '任务等待中',
  "safeErrorMessage" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "eventSequence" INTEGER NOT NULL DEFAULT 0,
  "resultVersionId" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenerationJobEvent" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "jobId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "stage" TEXT,
  "message" TEXT NOT NULL,
  "progress" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationJobEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GenerationVersion" ADD COLUMN "jobId" TEXT;

CREATE UNIQUE INDEX "GenerationJob_resultVersionId_key" ON "GenerationJob"("resultVersionId");
CREATE INDEX "GenerationJob_projectId_queuedAt_idx" ON "GenerationJob"("projectId", "queuedAt");
CREATE INDEX "GenerationJob_status_queuedAt_idx" ON "GenerationJob"("status", "queuedAt");
CREATE UNIQUE INDEX "GenerationJob_one_active_per_project"
ON "GenerationJob"("projectId")
WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRYING');
CREATE UNIQUE INDEX "GenerationJobEvent_jobId_sequence_key" ON "GenerationJobEvent"("jobId", "sequence");
CREATE INDEX "GenerationJobEvent_jobId_createdAt_idx" ON "GenerationJobEvent"("jobId", "createdAt");
CREATE INDEX "GenerationVersion_jobId_createdAt_idx" ON "GenerationVersion"("jobId", "createdAt");

ALTER TABLE "GenerationJob"
ADD CONSTRAINT "GenerationJob_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GenerationJob"
ADD CONSTRAINT "GenerationJob_resultVersionId_fkey"
FOREIGN KEY ("resultVersionId") REFERENCES "GenerationVersion"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GenerationVersion"
ADD CONSTRAINT "GenerationVersion_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GenerationJobEvent"
ADD CONSTRAINT "GenerationJobEvent_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
