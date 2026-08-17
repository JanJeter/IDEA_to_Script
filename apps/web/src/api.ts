import type {
  CreateProjectInput,
  GenerationJob,
  Health,
  Project,
  ProjectSummary,
  Scene,
  ProjectDraft,
  StageKey,
  TrendBriefResponse,
  TrendFeed,
  AccessSession,
} from './types';
import type { Challenge, Solution } from 'altcha-lib/types';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string | string[] };
    const message = Array.isArray(payload.message) ? payload.message.join('，') : payload.message;
    if (response.status === 401 && !path.startsWith('/access/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ids:unauthorized'));
    }
    throw new ApiError(message ?? `请求失败 (${response.status})`, response.status);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>('/health'),
  accessSession: () => request<AccessSession>('/access/session'),
  authorizeAccess: (code: string) =>
    request<AccessSession>('/access/authorize', {
      method: 'POST',
      headers: { 'X-IDS-Access': 'authorize' },
      body: JSON.stringify({ code }),
    }),
  logoutAccess: () => request<AccessSession>('/access/logout', { method: 'POST' }),
  listTrends: () => request<TrendFeed>('/trends'),
  refreshTrends: () => request<TrendFeed>('/trends/refresh', { method: 'POST' }),
  getTrendBrief: (id: string) => request<TrendBriefResponse>(`/trends/${id}/brief`),
  listProjects: () => request<ProjectSummary[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (input: CreateProjectInput) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  getGenerationChallenge: (projectId: string) =>
    request<Challenge>(`/projects/${projectId}/generate/challenge`),
  authorizeGeneration: (projectId: string, payload: { challenge: Challenge; solution: Solution }) =>
    request<{ ticket: string; expiresInSeconds: number }>(`/projects/${projectId}/generate/authorize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  enqueueGeneration: (projectId: string, ticket: string) =>
    request<GenerationJob>(`/projects/${projectId}/generate/jobs`, {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    }),
  regenerateStage: (projectId: string, stage: StageKey, ticket: string) =>
    request<GenerationJob>(`/projects/${projectId}/stages/${stage}/generate`, {
      method: 'POST',
      body: JSON.stringify({ ticket }),
    }),
  updateStage: (projectId: string, stage: StageKey, content: Record<string, unknown>) =>
    request<{ draft: ProjectDraft }>(`/projects/${projectId}/stages/${stage}`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  confirmStage: (projectId: string, stage: StageKey) =>
    request<{ job: GenerationJob | null; completed: boolean }>(
      `/projects/${projectId}/stages/${stage}/confirm`,
      { method: 'POST' },
    ),
  getGenerationJob: (jobId: string) => request<GenerationJob>(`/jobs/${jobId}`),
  getActiveGenerationJob: (projectId: string) =>
    request<{ job: GenerationJob | null }>(`/projects/${projectId}/generate/job`),
  updateScene: (projectId: string, sceneId: string, input: Partial<Scene>) =>
    request<Scene>(`/projects/${projectId}/scenes/${sceneId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteProject: (id: string) => request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
};
