export type ScreenplayProjectMode = 'ORIGINAL' | 'ADAPTATION' | 'TREND_INSPIRED';

export interface ProjectSeedMemory {
  mode: ScreenplayProjectMode;
  title: string;
  logline: string;
  sourceText?: string | null;
  genre: string;
  tone: string;
  language: string;
  targetMinutes: number;
}

export interface ProjectCanonicalMemory {
  revision: string;
  confirmedStage?: string | null;
  premise?: {
    title: string;
    premise: string;
    synopsis: string;
    theme: string;
  } | null;
  characters?: unknown;
  relationships?: unknown;
  locations?: unknown;
  beats?: unknown;
  scenePlans?: unknown;
  writtenScenes?: unknown;
}

export interface ProjectMemorySnapshot {
  projectId: string;
  versionId: string;
  seed: ProjectSeedMemory;
  canonical: ProjectCanonicalMemory;
}

export interface ProjectMemoryScope {
  projectId: string;
  versionId: string;
  stage: string;
}

export interface ProjectMemoryPort {
  load(scope: ProjectMemoryScope): Promise<ProjectMemorySnapshot>;
}

export class StaticProjectMemoryPort implements ProjectMemoryPort {
  constructor(private readonly snapshot: ProjectMemorySnapshot) {}

  async load(scope: ProjectMemoryScope) {
    if (scope.projectId !== this.snapshot.projectId || scope.versionId !== this.snapshot.versionId) {
      throw new Error('Agent memory scope does not match the supplied project snapshot');
    }
    return this.snapshot;
  }
}
