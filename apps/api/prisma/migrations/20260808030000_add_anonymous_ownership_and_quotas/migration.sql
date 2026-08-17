CREATE TABLE "AnonymousVisitor" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnonymousVisitor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnonymousVisitor_tokenHash_key" ON "AnonymousVisitor"("tokenHash");

-- Preserve pre-ownership MVP data without exposing it to a newly created browser identity.
INSERT INTO "AnonymousVisitor" ("id", "tokenHash")
VALUES ('legacy-mvp-owner', 'legacy-mvp-owner-inaccessible');

ALTER TABLE "Project"
ADD COLUMN "visitorId" TEXT NOT NULL DEFAULT 'legacy-mvp-owner';

ALTER TABLE "Project" ALTER COLUMN "visitorId" DROP DEFAULT;
DROP INDEX "Project_updatedAt_idx";
CREATE INDEX "Project_visitorId_updatedAt_idx" ON "Project"("visitorId", "updatedAt");

ALTER TABLE "Project"
ADD CONSTRAINT "Project_visitorId_fkey"
FOREIGN KEY ("visitorId") REFERENCES "AnonymousVisitor"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailyVisitorQuota" (
  "visitorId" TEXT NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "realGenerations" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyVisitorQuota_pkey" PRIMARY KEY ("visitorId", "day")
);

CREATE TABLE "DailyIpQuota" (
  "ipHash" VARCHAR(64) NOT NULL,
  "day" VARCHAR(10) NOT NULL,
  "projectsCreated" INTEGER NOT NULL DEFAULT 0,
  "realGenerations" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DailyIpQuota_pkey" PRIMARY KEY ("ipHash", "day")
);

CREATE TABLE "GlobalDailyGenerationQuota" (
  "day" VARCHAR(10) NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalDailyGenerationQuota_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "GlobalMonthlyGenerationQuota" (
  "month" VARCHAR(7) NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalMonthlyGenerationQuota_pkey" PRIMARY KEY ("month")
);

ALTER TABLE "DailyVisitorQuota"
ADD CONSTRAINT "DailyVisitorQuota_visitorId_fkey"
FOREIGN KEY ("visitorId") REFERENCES "AnonymousVisitor"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
