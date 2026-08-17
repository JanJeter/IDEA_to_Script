ALTER TABLE "GenerationVersion" ADD COLUMN "relationships" JSONB;

CREATE UNIQUE INDEX "Character_projectId_id_key"
ON "Character"("projectId", "id");

CREATE TABLE "CharacterRelationship" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "projectId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "strength" INTEGER NOT NULL DEFAULT 1,
  "directed" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CharacterRelationship_distinct_endpoints_check" CHECK ("sourceId" <> "targetId"),
  CONSTRAINT "CharacterRelationship_strength_check" CHECK ("strength" BETWEEN 1 AND 5),
  CONSTRAINT "CharacterRelationship_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CharacterRelationship_projectId_sortOrder_idx"
ON "CharacterRelationship"("projectId", "sortOrder");

CREATE INDEX "CharacterRelationship_sourceId_idx"
ON "CharacterRelationship"("sourceId");

CREATE INDEX "CharacterRelationship_targetId_idx"
ON "CharacterRelationship"("targetId");

ALTER TABLE "CharacterRelationship"
ADD CONSTRAINT "CharacterRelationship_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterRelationship"
ADD CONSTRAINT "CharacterRelationship_projectId_sourceId_fkey"
FOREIGN KEY ("projectId", "sourceId") REFERENCES "Character"("projectId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CharacterRelationship"
ADD CONSTRAINT "CharacterRelationship_projectId_targetId_fkey"
FOREIGN KEY ("projectId", "targetId") REFERENCES "Character"("projectId", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
