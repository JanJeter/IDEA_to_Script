export type PremiseResult = {
  title: string;
  premise: string;
  synopsis: string;
  theme: string;
};

export type CharacterResult = {
  name: string;
  role: string;
  age?: string;
  description: string;
  goal: string;
  conflict: string;
  arc: string;
  voice: string;
};

export type CharacterRelationshipResult = {
  sourceIndex: number;
  targetIndex: number;
  type: string;
  description: string;
  strength: number;
  directed: boolean;
};

export type LocationResult = {
  name: string;
  description: string;
  atmosphere: string;
  recurringElements: string;
};

export type BeatResult = {
  act: number;
  sequence: number;
  title: string;
  summary: string;
  emotionalShift: string;
};

export type ScenePlanResult = {
  sceneNumber: number;
  beatSequence: number;
  heading: string;
  location: string;
  timeOfDay: string;
  summary: string;
  estimatedSeconds: number;
};

export type DialogueLine = {
  character: string;
  parenthetical?: string;
  text: string;
};

export type WrittenSceneResult = {
  sceneNumber: number;
  action: string;
  dialogue: DialogueLine[];
};

export type StageKey = 'PREMISE' | 'CHARACTERS' | 'LOCATIONS' | 'BEATS' | 'SCENES' | 'SCRIPT';

export const generationStages: StageKey[] = [
  'PREMISE',
  'CHARACTERS',
  'LOCATIONS',
  'BEATS',
  'SCENES',
  'SCRIPT',
];

export function isStageKey(value: string): value is StageKey {
  return generationStages.includes(value as StageKey);
}

export function nextStage(stage: StageKey): StageKey | null {
  return generationStages[generationStages.indexOf(stage) + 1] ?? null;
}

export type GenerationEvent = {
  type:
    | 'job:queued'
    | 'job:running'
    | 'job:retrying'
    | 'job:succeeded'
    | 'pipeline:start'
    | 'stage:start'
    | 'stage:complete'
    | 'pipeline:complete'
    | 'error';
  stage?: StageKey;
  message: string;
  progress: number;
  projectId: string;
};
