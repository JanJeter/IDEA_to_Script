import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateProjectInput, Project } from './types';

const mocks = vi.hoisted(() => ({
  api: {
    health: vi.fn(), accessSession: vi.fn(), authorizeAccess: vi.fn(),
    listProjects: vi.fn(), createProject: vi.fn(), getProject: vi.fn(),
    getActiveGenerationJob: vi.fn(),
  },
  resetGeneration: vi.fn(),
}));
vi.mock('./api', () => ({ api: mocks.api }));
const pendingInput: CreateProjectInput = {
  mode: 'ORIGINAL', title: '零点十七分', logline: '一个失眠的维修工听见七年前的广播。',
  genre: '现实悬疑', tone: '克制、紧张', targetMinutes: 8, language: 'zh-CN',
};
vi.mock('./components/LandingPage', () => ({
  LandingPage: ({ onCreate }: { onCreate: (input: CreateProjectInput) => Promise<void> }) => (
    <div data-testid="landing">
      <button type="button" onClick={() => void onCreate(pendingInput)}>提交故事</button>
    </div>
  ),
}));
// Keep the real AccessGate: verify the actual access-code form and its error state.
vi.mock('./components/TrendRadar', () => ({ TrendRadar: () => <div data-testid="trend-radar" /> }));
vi.mock('./components/Studio', () => ({
  Studio: ({ project }: { project: Project }) => <div data-testid="studio">{project.title}</div>,
}));
vi.mock('./components/Sidebar', () => ({ Sidebar: () => <aside /> }));
vi.mock('./components/CreateProjectModal', () => ({ CreateProjectModal: () => null }));
vi.mock('./hooks/useGenerationJob', () => ({
  useGenerationJob: () => ({
    generating: false, events: [], progress: 0, prepare: vi.fn(), watch: vi.fn(),
    failPreparation: vi.fn(), reset: mocks.resetGeneration, setIdleProgress: vi.fn(),
  }),
}));
import App from './App';
const createdProject = {
  id: 'project-1', title: pendingInput.title, status: 'DRAFT', currentStage: 'IDEA',
  expiresAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
} as Project;

describe('App access-code routing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('scrollTo', vi.fn());
    mocks.api.health.mockResolvedValue({ status: 'ok', generationMode: 'demo', model: 'demo' });
    mocks.api.accessSession.mockResolvedValue({ required: true, authorized: false });
    mocks.api.authorizeAccess.mockResolvedValue({ required: true, authorized: true });
    mocks.api.listProjects.mockResolvedValue([]);
    mocks.api.getActiveGenerationJob.mockResolvedValue({ job: null });
    mocks.api.getProject.mockResolvedValue(createdProject);
    mocks.api.createProject.mockResolvedValue(createdProject);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  async function authorize() {
    fireEvent.change(await screen.findByLabelText('访问码'), { target: { value: 'IDS-TEST-CODE' } });
    fireEvent.click(screen.getByRole('button', { name: '进入编剧室' }));
  }

  it('fails closed when session services are unavailable', async () => {
    mocks.api.health.mockRejectedValue(new Error('offline'));
    mocks.api.accessSession.mockRejectedValue(new Error('offline'));
    render(<App />);
    expect(await screen.findByLabelText('访问码')).toBeInTheDocument();
    expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
    expect(mocks.api.listProjects).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('keeps the complete sample public without an access code', async () => {
    window.history.replaceState({}, '', '/workspace/sample');
    render(<App />);
    expect(await screen.findByTestId('studio')).toHaveTextContent('零点十七分');
    expect(screen.queryByLabelText('访问码')).not.toBeInTheDocument();
    expect(mocks.api.getProject).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/workspace/sample');
  });

  it('opens a protected trend route after access-code authorization', async () => {
    window.history.replaceState({}, '', '/trends');
    render(<App />);
    expect(screen.queryByTestId('trend-radar')).not.toBeInTheDocument();
    await authorize();
    expect(await screen.findByTestId('trend-radar')).toBeInTheDocument();
    expect(mocks.api.authorizeAccess).toHaveBeenCalledWith('IDS-TEST-CODE');
    expect(window.location.pathname).toBe('/trends');
  });

  it('creates the submitted story after authorization', async () => {
    render(<App />);
    await authorize();
    await screen.findByTestId('landing');
    fireEvent.click(screen.getByRole('button', { name: '提交故事' }));
    await waitFor(() => expect(mocks.api.createProject).toHaveBeenCalledWith(pendingInput));
    await waitFor(() => expect(window.location.pathname).toBe('/workspace/project-1'));
  });

  it('keeps rejected access codes outside protected routes', async () => {
    window.history.replaceState({}, '', '/trends');
    mocks.api.authorizeAccess.mockRejectedValue(new Error('访问码无效'));
    render(<App />);
    await authorize();
    expect(await screen.findByRole('alert')).toHaveTextContent('访问码无效');
    expect(screen.queryByTestId('trend-radar')).not.toBeInTheDocument();
    expect(mocks.api.listProjects).not.toHaveBeenCalled();
  });

  it('returns to the access gate when an authorized session expires', async () => {
    mocks.api.accessSession.mockResolvedValue({ required: true, authorized: true });
    window.history.replaceState({}, '', '/trends');
    render(<App />);
    await screen.findByTestId('trend-radar');
    fireEvent(window, new Event('ids:unauthorized'));
    expect(await screen.findByLabelText('访问码')).toBeInTheDocument();
    expect(screen.queryByTestId('trend-radar')).not.toBeInTheDocument();
    expect(mocks.resetGeneration).toHaveBeenCalled();
  });
});
