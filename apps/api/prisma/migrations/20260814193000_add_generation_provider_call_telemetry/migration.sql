ALTER TABLE "GenerationRun"
ADD COLUMN "providerCallCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "providerDurationMs" INTEGER;

CREATE TABLE "GenerationProviderCall" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "structured" BOOLEAN NOT NULL,
  "outcome" VARCHAR(40) NOT NULL,
  "retryable" BOOLEAN NOT NULL,
  "httpStatus" INTEGER,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GenerationProviderCall_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GenerationProviderCall_runId_sequence_key"
ON "GenerationProviderCall"("runId", "sequence");

CREATE INDEX "GenerationProviderCall_runId_createdAt_idx"
ON "GenerationProviderCall"("runId", "createdAt");

ALTER TABLE "GenerationProviderCall"
ADD CONSTRAINT "GenerationProviderCall_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "GenerationRun"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
