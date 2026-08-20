-- Additive password authentication. Existing anonymous visitors and their projects remain intact.
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" VARCHAR(32) NOT NULL,
    "usernameNormalized" VARCHAR(64) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "visitorId" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthThrottle" (
    "key" VARCHAR(96) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "subjectHash" VARCHAR(64) NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthThrottle_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "User_usernameNormalized_key" ON "User"("usernameNormalized");
CREATE UNIQUE INDEX "User_visitorId_key" ON "User"("visitorId");
CREATE INDEX "User_status_idx" ON "User"("status");
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
CREATE INDEX "AuthThrottle_scope_subjectHash_idx" ON "AuthThrottle"("scope", "subjectHash");
CREATE INDEX "AuthThrottle_updatedAt_idx" ON "AuthThrottle"("updatedAt");

ALTER TABLE "User" ADD CONSTRAINT "User_visitorId_fkey"
FOREIGN KEY ("visitorId") REFERENCES "AnonymousVisitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
