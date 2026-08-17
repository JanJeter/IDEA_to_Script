import type { GenerationVersion } from '@prisma/client';

export function toGenerationDraft(version: GenerationVersion | null | undefined) {
  if (!version) return null;
  return {
    id: version.id,
    currentStage: version.currentStage,
    confirmedStage: version.confirmedStage,
    title: version.title,
    premise: version.premise,
    synopsis: version.synopsis,
    theme: version.theme,
    characters: version.characters,
    relationships: version.relationships,
    locations: version.locations,
    beats: version.beats,
    scenePlans: version.scenePlans,
    scriptText: version.scriptText,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}
