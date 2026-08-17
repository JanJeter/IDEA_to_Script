CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED');
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "Project" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "title" TEXT NOT NULL,
  "logline" TEXT NOT NULL,
  "genre" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'zh-CN',
  "targetMinutes" INTEGER NOT NULL DEFAULT 8,
  "premise" TEXT,
  "synopsis" TEXT,
  "theme" TEXT,
  "scriptText" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "currentStage" TEXT NOT NULL DEFAULT 'IDEA',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Character" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "age" TEXT,
  "description" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "conflict" TEXT NOT NULL,
  "arc" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Location" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "atmosphere" TEXT NOT NULL,
  "recurringElements" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Beat" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "act" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "emotionalShift" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Beat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Scene" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "beatId" TEXT,
  "sceneNumber" INTEGER NOT NULL,
  "heading" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "timeOfDay" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "dialogue" JSONB NOT NULL,
  "estimatedSeconds" INTEGER NOT NULL DEFAULT 60,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenerationRun" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
  "model" TEXT NOT NULL,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "GenerationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");
CREATE INDEX "Character_projectId_sortOrder_idx" ON "Character"("projectId", "sortOrder");
CREATE INDEX "Location_projectId_sortOrder_idx" ON "Location"("projectId", "sortOrder");
CREATE UNIQUE INDEX "Beat_projectId_sequence_key" ON "Beat"("projectId", "sequence");
CREATE INDEX "Beat_projectId_act_sequence_idx" ON "Beat"("projectId", "act", "sequence");
CREATE UNIQUE INDEX "Scene_projectId_sceneNumber_key" ON "Scene"("projectId", "sceneNumber");
CREATE INDEX "Scene_projectId_sceneNumber_idx" ON "Scene"("projectId", "sceneNumber");
CREATE INDEX "GenerationRun_projectId_startedAt_idx" ON "GenerationRun"("projectId", "startedAt");

ALTER TABLE "Character" ADD CONSTRAINT "Character_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Beat" ADD CONSTRAINT "Beat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_beatId_fkey" FOREIGN KEY ("beatId") REFERENCES "Beat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GenerationRun" ADD CONSTRAINT "GenerationRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
