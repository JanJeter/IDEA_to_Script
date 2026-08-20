import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput, Project } from './types';

const mocks = vi.hoisted(() => ({
  api: {
    health: vi.fn(),
    authSession: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    getProject: vi.fn(),
    getActiveGenerationJob: vi.fn(),
  },
  resetGeneration: vi.fn(),
}));

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  api: mocks.api,
}));

const pendingInput: CreateProjectInput = {
  mode: 'ORIGINAL',
  title: '零点十七分',
  logline: '一个失眠的维修工听见七年前的广播。',
  genre: '现实悬疑',
  tone: '克制、紧张',
  targetMinutes: 8,
  language: 'zh-CN',
};

vi.mock('./components/LandingPage', () => ({
  LandingPage: ({ onCreate, onOpenAuth }: {
    onCreate: (input: CreateProjectInput) => Promise<void>;
    onOpenAuth: () => void;
  }) => (
    <div data-testid="landing">
      <button type="button" onClick={() => void onCreate(pendingInput)}>提交故事</button>
      <button type="button" onClick={onOpenAuth}>打开登录</button>
    </div>
  ),
}));

vi.mock('./components/AuthPage', () => ({
  AuthPage: ({ continuation, onLogin, onRegister }: {
    continuation?: string;
    onLogin: (identifier: string, password: string) => Promise<void>;
    onRegister: (username: string, password: string, confirmation: string) => Promise<void>;
  }) => (
    <div data-testid="auth-page">
      {continuation && <p>{continuation}</p>}
      <button type="button" onClick={() => void onLogin('writer', 'story-room-2026')}>测试登录</button>
      <button type="button" onClick={() => void onRegister('writer', 'story-room-2026', 'story-room-2026')}>测试注册</button>
    </div>
  ),
}));

vi.mock('./components/TrendRadar', () => ({
  TrendRadar: () => <div data-testid="trend-radar">热点选题台</div>,
}));

vi.mock('./components/Studio', () => ({
  Studio: ({ project }: { project: Project }) => <div data-testid="studio">{project.title}</div>,
}));

vi.mock('./components/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('./components/CreateProjectModal', () => ({ CreateProjectModal: () => null }));
vi.mock('./hooks/useGenerationJob', () => ({
  useGenerationJob: () => ({
    generating: false,
    events: [],
    progress: 0,
    prepare: vi.fn(),
    watch: vi.fn(),
    failPreparation: vi.fn(),
    reset: mocks.resetGeneration,
    setIdleProgress: vi.fn(),
  }),
}));

import App from './App';

const createdProject = {
  id: 'project-1',
  title: pendingInput.title,
  status: 'DRAFT',
  currentStage: 'IDEA',
  expiresAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as Project;

describe('App authentication routing', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('scrollTo', vi.fn());
    mocks.api.health.mockResolvedValue({ status: 'ok', generationMode: 'demo', model: 'demo' });
    mocks.api.authSession.mockResolvedValue({ authenticated: false, user: null });
    mocks.api.listProjects.mockResolvedValue([]);
    mocks.api.getActiveGenerationJob.mockResolvedValue({ job: null });
    mocks.api.getProject.mockResolvedValue(createdProject);
    mocks.api.createProject.mockResolvedValue(createdProject);
    mocks.api.logout.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the homepage public even when session services are unavailable', async () => {
    mocks.api.health.mockRejectedValue(new Error('offline'));
    mocks.api.authSession.mockRejectedValue(new Error('offline'));
    render(<App />);
    expect(screen.getByTestId('landing')).toBeInTheDocument();
    await waitFor(() => expect(mocks.api.authSession).toHaveBeenCalledOnce());
    expect(window.location.pathname).toBe('/');
  });

  it('keeps the complete sample public for a signed-out visitor', async () => {
    window.history.replaceState({}, '', '/workspace/sample');
    render(<App />);

    expect(await screen.findByTestId('studio')).toHaveTextContent('零点十七分');
    expect(screen.queryByTestId('auth-page')).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/workspace/sample');
  });

  it('returns to a protected trend route after login', async () => {
    window.history.replaceState({}, '', '/trends');
    mocks.api.login.mockResolvedValue({ authenticated: true, user: { id: 'user-1', username: 'writer' } });
    render(<App />);

    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe('/login'));
    fireEvent.click(screen.getByRole('button', { name: '测试登录' }));

    expect(await screen.findByTestId('trend-radar')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/trends');
  });

  it('keeps a signed-out creation payload and continues it after registration', async () => {
    mocks.api.register.mockResolvedValue({ authenticated: true, user: { id: 'user-1', username: 'writer' } });
    render(<App />);
    await waitFor(() => expect(mocks.api.authSession).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: '提交故事' }));
    expect(await screen.findByText(/登录后将继续创建《零点十七分》/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '测试注册' }));

    await waitFor(() => expect(mocks.api.createProject).toHaveBeenCalledWith(pendingInput));
    await waitFor(() => expect(window.location.pathname).toBe('/workspace/project-1'));
  });
});
