export type ProjectStatus = 'DRAFT' | 'GENERATING' | 'REVIEWING' | 'READY' | 'FAILED';
export type ProjectMode = 'ORIGINAL' | 'ADAPTATION' | 'TREND_INSPIRED';
export type GenerationJobStatus = 'QUEUED' | 'RUNNING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED';
export type StageKey = 'PREMISE' | 'CHARACTERS' | 'LOCATIONS' | 'BEATS' | 'SCENES' | 'SCRIPT';

export type DialogueLine = {
  character: string;
  parenthetical?: string;
  text: string;
};

export type Character = {
  id: string;
  name: string;
  role: string;
  age?: string;
  description: string;
  goal: string;
  conflict: string;
  arc: string;
  voice: string;
};

export type CharacterRelationshipDraft = {
  sourceIndex: number;
  targetIndex: number;
  type: string;
  description: string;
  strength: number;
  directed: boolean;
};

export type CharacterRelationship = {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  description: string;
  strength: number;
  directed: boolean;
  source?: Pick<Character, 'id' | 'name'>;
  target?: Pick<Character, 'id' | 'name'>;
};

export type Location = {
  id: string;
  name: string;
  description: string;
  atmosphere: string;
  recurringElements: string;
};

export type Beat = {
  id: string;
  act: number;
  sequence: number;
  title: string;
  summary: string;
  emotionalShift: string;
};

export type Scene = {
  id: string;
  sceneNumber: number;
  heading: string;
  location: string;
  timeOfDay: string;
  summary: string;
  action: string;
  dialogue: DialogueLine[];
  estimatedSeconds: number;
};

export type CharacterDraft = Omit<Character, 'id'>;
export type LocationDraft = Omit<Location, 'id'>;
export type BeatDraft = Omit<Beat, 'id'>;
export type ScenePlanDraft = Omit<Scene, 'id' | 'action' | 'dialogue'> & { beatSequence: number };

export type ProjectDraft = {
  id: string;
  currentStage: StageKey | 'IDEA';
  confirmedStage: StageKey | null;
  title?: string;
  premise?: string;
  synopsis?: string;
  theme?: string;
  characters?: CharacterDraft[];
  relationships?: CharacterRelationshipDraft[];
  locations?: LocationDraft[];
  beats?: BeatDraft[];
  scenePlans?: ScenePlanDraft[];
  scriptText?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSummary = {
  id: string;
  mode?: ProjectMode;
  trendTopicId?: string | null;
  title: string;
  logline: string;
  genre: string;
  tone: string;
  targetMinutes: number;
  status: ProjectStatus;
  currentStage: string;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { scenes: number; characters: number };
};

export type Project = Omit<ProjectSummary, '_count'> & {
  language: string;
  sourceText?: string;
  premise?: string;
  synopsis?: string;
  theme?: string;
  scriptText?: string;
  characters: Character[];
  relationships?: CharacterRelationship[];
  locations: Location[];
  beats: Beat[];
  scenes: Scene[];
  draft: ProjectDraft | null;
  trendTopic?: Pick<TrendTopic, 'id' | 'title' | 'sourceLabel' | 'sourceUrl' | 'riskLevel'> | null;
};

export type CreateProjectInput = {
  mode?: ProjectMode;
  trendTopicId?: string;
  title: string;
  logline: string;
  sourceText?: string;
  genre: string;
  tone: string;
  targetMinutes: number;
  language: string;
};

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
  stage?: string;
  message: string;
  progress: number;
  projectId: string;
};

export type GenerationJob = {
  id: string;
  projectId: string;
  versionId: string | null;
  stage: StageKey;
  status: GenerationJobStatus;
  progress: number;
  currentStage: string | null;
  message: string;
  error: string | null;
  attempt: number;
  resultVersionId: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type Health = {
  status: string;
  generationMode: 'demo' | 'llm';
  model: string;
};

export type AuthUser = {
  id: string;
  username: string;
};

export type AuthSession = {
  authenticated: boolean;
  user: AuthUser | null;
};

export type TrendRiskLevel = 'LOW' | 'REVIEW' | 'BLOCKED';

export type TrendTopic = {
  id: string;
  title: string;
  excerpt: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string;
  license: string;
  category: string;
  rank: number | null;
  views: number | null;
  heatScore: number;
  momentumScore: number;
  riskLevel: TrendRiskLevel;
  riskReasons: string[];
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type TrendSourceStatus = {
  id: string;
  label: string;
  status: 'ok' | 'error';
  message?: string;
  lastSuccessAt: string | null;
  stale: boolean;
  degraded?: boolean;
};

export type TrendFeed = {
  items: TrendTopic[];
  refreshedAt: string | null;
  stale: boolean;
  sources: TrendSourceStatus[];
};

export type TrendCreativeBrief = {
  prompt: string;
  creativeKernel: string;
  audienceQuestion: string;
  safetyRules: string[];
  provenance: string[];
};

export type TrendBriefResponse = {
  topic: TrendTopic;
  brief: TrendCreativeBrief;
  projectInput: CreateProjectInput & { mode: 'TREND_INSPIRED'; trendTopicId: string };
};
