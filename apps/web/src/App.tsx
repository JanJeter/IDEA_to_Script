import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bot, CircleHelp, Menu, X } from 'lucide-react';
import { solveChallenge } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/web/pbkdf2';
import { api } from './api';
import { AccessGate } from './components/AccessGate';
import { CreateProjectModal } from './components/CreateProjectModal';
import { LandingPage } from './components/LandingPage';
import { Sidebar } from './components/Sidebar';
import { Studio } from './components/Studio';
import { TrendRadar } from './components/TrendRadar';
import { useGenerationJob } from './hooks/useGenerationJob';
import { sampleProject, sampleSummary } from './sample-project';
import type {
  CreateProjectInput,
  AccessSession,
  Health,
  Project,
  ProjectSummary,
  Scene,
  StageKey,
  TrendBriefResponse,
} from './types';

type Route = { page: 'home' } | { page: 'trends' } | { page: 'workspace'; projectId: string };
type CreationMode = 'original' | 'adaptation' | 'trend';

function readRoute(): Route {
  if (/^\/trends\/?$/.test(window.location.pathname)) return { page: 'trends' };
  const match = window.location.pathname.match(/^\/workspace\/([^/]+)\/?$/);
  return match ? { page: 'workspace', projectId: decodeURIComponent(match[1]) } : { page: 'home' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | undefined>(() => {
    const initialRoute = readRoute();
    return initialRoute.page === 'workspace' && initialRoute.projectId === sampleProject.id ? sampleProject : undefined;
  });
  const [health, setHealth] = useState<Health>();
  const [access, setAccess] = useState<AccessSession>();
  const [accessChecking, setAccessChecking] = useState(true);
  const [loading, setLoading] = useState(route.page === 'workspace' && route.projectId !== sampleProject.id);
  const [creating, setCreating] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [creationSeed, setCreationSeed] = useState('');
  const [creationMode, setCreationMode] = useState<CreationMode>('original');
  const [creationInitial, setCreationInitial] = useState<CreateProjectInput>();
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);

  const isSample = project?.id === sampleProject.id;

  const navigate = useCallback((next: Route, replace = false) => {
    const path = next.page === 'home' ? '/' : next.page === 'trends' ? '/trends' : `/workspace/${encodeURIComponent(next.projectId)}`;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  const refreshList = useCallback(async () => {
    const list = await api.listProjects();
    setProjects(list);
    return list;
  }, []);

  const handleGenerationSucceeded = useCallback(
    async (projectId: string) => {
      const updated = await api.getProject(projectId);
      setProject((current) => (current?.id === projectId ? updated : current));
      await refreshList();
    },
    [refreshList],
  );

  const handleGenerationFailed = useCallback(
    (message: string) => {
      setError(message);
      const projectId = project?.id;
      if (projectId && projectId !== sampleProject.id) {
        void api
          .getProject(projectId)
          .then((updated) => setProject((current) => (current?.id === projectId ? updated : current)))
          .catch(() => undefined);
      }
      void refreshList().catch(() => undefined);
    },
    [project?.id, refreshList],
  );

  const {
    generating,
    events,
    progress,
    prepare: prepareGeneration,
    watch: watchGeneration,
    failPreparation,
    reset: resetGeneration,
    setIdleProgress,
  } = useGenerationJob({
    onSucceeded: handleGenerationSucceeded,
    onFailed: handleGenerationFailed,
  });

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      setAccess({ required: true, authorized: false });
      setProjects([]);
      setProject((current) => (current?.id === sampleProject.id ? current : undefined));
      resetGeneration();
    };
    window.addEventListener('ids:unauthorized', onUnauthorized);
    return () => window.removeEventListener('ids:unauthorized', onUnauthorized);
  }, [resetGeneration]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([api.health(), api.accessSession()])
      .then(([healthResult, accessResult]) => {
        if (cancelled) return;
        if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
        if (accessResult.status === 'fulfilled') {
          setAccess(accessResult.value);
          if (accessResult.value.authorized) {
            void refreshList().catch(() => setError('项目列表暂时无法加载，请稍后重试。'));
          }
        } else {
          setError('无法确认访问状态，请检查服务连接后重试。');
        }
      })
      .finally(() => {
        if (!cancelled) setAccessChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  useEffect(() => {
    let cancelled = false;
    setMobileNav(false);
    setModalOpen(false);
    setCreationInitial(undefined);
    setError('');
    resetGeneration();

    const isPublicSampleRoute = route.page === 'workspace' && route.projectId === sampleProject.id;
    if (!isPublicSampleRoute && (!access || (access.required && !access.authorized))) {
      setProject(undefined);
      setLoading(false);
      return () => {
        cancelled = true;
        resetGeneration();
      };
    }

    if (route.page === 'home' || route.page === 'trends') {
      setProject(undefined);
      setLoading(false);
      return () => {
        cancelled = true;
        resetGeneration();
      };
    }

    if (route.projectId === sampleProject.id) {
      setProject(sampleProject);
      setIdleProgress(100);
      setLoading(false);
      return () => {
        cancelled = true;
        resetGeneration();
      };
    }

    setLoading(true);
    void Promise.allSettled([
      api.getProject(route.projectId),
      api.getActiveGenerationJob(route.projectId),
    ])
      .then(([selectedResult, activeResult]) => {
        if (cancelled) return;
        if (selectedResult.status === 'rejected') throw selectedResult.reason;
        const selected = selectedResult.value;
        setProject(selected);
        setIdleProgress(selected.status === 'READY' ? 100 : 0);
        if (activeResult.status === 'fulfilled' && activeResult.value.job) {
          watchGeneration(activeResult.value.job);
        } else if (activeResult.status === 'rejected') {
          setError('项目已打开，但后台任务状态暂时无法确认；请稍后刷新以恢复实时进度。');
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setProject(undefined);
        setError(reason instanceof Error ? reason.message : '无法打开这个项目');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      resetGeneration();
    };
  }, [access, resetGeneration, route, setIdleProgress, watchGeneration]);

  const selectProject = useCallback((id: string) => {
    navigate({ page: 'workspace', projectId: id });
  }, [navigate]);

  function openCreator(seed = '', mode: CreationMode = 'original', initial?: CreateProjectInput) {
    setCreationSeed(seed);
    setCreationMode(mode);
    setCreationInitial(initial);
    setModalOpen(true);
  }

  function useTrend(selection: TrendBriefResponse) {
    openCreator('', 'trend', selection.projectInput);
  }

  async function createProject(input: CreateProjectInput) {
    setCreating(true);
    try {
      const created = await api.createProject(input);
      setModalOpen(false);
      setCreationInitial(undefined);
      resetGeneration();
      navigate({ page: 'workspace', projectId: created.id });
      void refreshList().catch(() => {
        setError('项目已经创建，但项目列表暂时没有刷新；重新打开页面即可恢复。');
      });
    } finally {
      setCreating(false);
    }
  }

  async function authorizeAccess(code: string) {
    const session = await api.authorizeAccess(code);
    setAccess(session);
    setError('');
    void refreshList().catch(() => setError('访问已通过，但项目列表暂时无法加载，请稍后重试。'));
  }

  async function removeProject(id: string) {
    const target = projects.find((item) => item.id === id);
    if (!window.confirm(`确定删除《${target?.title ?? '这个项目'}》？此操作不可撤销。`)) return;
    await api.deleteProject(id);
    await refreshList();
    if (project?.id === id) navigate({ page: 'workspace', projectId: sampleProject.id });
  }

  async function generate() {
    if (!project || isSample || generating) return;
    if (
      project.status === 'READY' &&
      !window.confirm('重新生成会在全部完成后替换当前人物、节拍和分场；失败时会保留现有内容。继续吗？')
    ) return;

    setError('');
    prepareGeneration(project.id);

    try {
      const challenge = await api.getGenerationChallenge(project.id);
      const solution = await solveChallenge({ challenge, deriveKey, timeout: 45_000 });
      if (!solution) throw new Error('安全验证超时，请重试');
      const { ticket } = await api.authorizeGeneration(project.id, { challenge, solution });
      const job = await api.enqueueGeneration(project.id, ticket);
      watchGeneration(job);
    } catch (reason) {
      failPreparation(reason instanceof Error ? reason.message : '安全验证失败，请重试');
    }
  }

  async function generateStage(stage: StageKey) {
    if (!project || isSample || generating) return;
    setError('');
    try {
      const challenge = await api.getGenerationChallenge(project.id);
      const solution = await solveChallenge({ challenge, deriveKey, timeout: 45_000 });
      if (!solution) throw new Error('安全验证超时，请重试');
      const { ticket } = await api.authorizeGeneration(project.id, { challenge, solution });
      const job = await api.regenerateStage(project.id, stage, ticket);
      watchGeneration(job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '阶段生成失败，请重试');
      throw reason;
    }
  }

  async function saveStage(stage: StageKey, content: Record<string, unknown>) {
    if (!project || isSample || generating) return;
    const { draft } = await api.updateStage(project.id, stage, content);
    setProject((current) => (current?.id === project.id ? { ...current, draft } : current));
  }

  async function confirmStage(stage: StageKey) {
    if (!project || isSample || generating) return;
    setError('');
    try {
      const result = await api.confirmStage(project.id, stage);
      const updated = await api.getProject(project.id);
      setProject((current) => (current?.id === project.id ? updated : current));
      await refreshList();
      if (result.job) watchGeneration(result.job);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '阶段确认失败，请重试');
      throw reason;
    }
  }

  async function saveScene(sceneId: string, input: Partial<Scene>) {
    if (!project || isSample) return;
    await api.updateScene(project.id, sceneId, input);
    const updated = await api.getProject(project.id);
    setProject(updated);
  }

  const systemLabel = useMemo(() => {
    if (isSample) return '完整示例';
    if (!health) return '服务连接中';
    return health.generationMode === 'llm' ? health.model : '演示生成器';
  }, [health, isSample]);

  const isPublicSampleRoute = route.page === 'workspace' && route.projectId === sampleProject.id;
  if ((accessChecking || !access || (access.required && !access.authorized)) && !isPublicSampleRoute) {
    return (
      <AccessGate
        checking={accessChecking}
        onAuthorize={authorizeAccess}
        onOpenSample={() => navigate({ page: 'workspace', projectId: sampleProject.id })}
      />
    );
  }

  if (route.page === 'home') {
    return (
      <>
        <LandingPage
          onStart={(seed, mode) => openCreator(seed, mode)}
          onOpenSample={() => navigate({ page: 'workspace', projectId: sampleProject.id })}
          onOpenTrends={() => navigate({ page: 'trends' })}
        />
        <CreateProjectModal
          open={modalOpen}
          busy={creating}
          seed={creationSeed}
          mode={creationMode}
          initial={creationInitial}
          onClose={() => !creating && setModalOpen(false)}
          onCreate={createProject}
        />
      </>
    );
  }

  if (route.page === 'trends') {
    return (
      <>
        <TrendRadar onHome={() => navigate({ page: 'home' })} onUseTrend={useTrend} />
        <CreateProjectModal
          open={modalOpen}
          busy={creating}
          seed={creationSeed}
          mode={creationMode}
          initial={creationInitial}
          onClose={() => !creating && setModalOpen(false)}
          onCreate={createProject}
        />
      </>
    );
  }

  return (
    <div className="app-shell">
      <div className={`sidebar-wrap ${mobileNav ? 'open' : ''}`}>
        <Sidebar
          projects={projects}
          sample={sampleSummary}
          selectedId={project?.id}
          onHome={() => navigate({ page: 'home' })}
          onSelectSample={() => selectProject(sampleProject.id)}
          onSelect={selectProject}
          onCreate={() => openCreator()}
          onDelete={(id) => void removeProject(id)}
        />
      </div>

      <main className="main-stage">
        <header className="topbar">
          <button className="mobile-menu" type="button" onClick={() => setMobileNav(!mobileNav)} aria-label="打开项目列表">
            {mobileNav ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="breadcrumb">
            <button type="button" onClick={() => navigate({ page: 'home' })}>首页</button><i>/</i><strong>{project?.title ?? '未找到项目'}</strong>
          </div>
          <div className="system-state" title={health?.model}>
            <Bot size={15} />
            <span>{systemLabel}</span>
            <i className={isSample || health?.status === 'ok' ? 'online' : ''} />
          </div>
          <button className="help-button" type="button" title="一句创意会依次生成人物、空间、节拍、分场与对白">
            <CircleHelp size={17} />
          </button>
        </header>

        {error && (
          <div className="error-banner"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>
        )}

        {loading ? (
          <div className="loading-screen"><span className="loader-mark">I/S</span><p>正在打开编剧室…</p></div>
        ) : project ? (
          <Studio
            project={project}
            readOnly={isSample}
            generating={generating}
            progress={progress}
            events={events}
            onGenerate={generate}
            onGenerateStage={generateStage}
            onConfirmStage={confirmStage}
            onSaveStage={saveStage}
            onStartProject={() => openCreator()}
            onSaveScene={saveScene}
          />
        ) : (
          <section className="empty-stage">
            <div className="empty-stage-number">PROJECT NOT FOUND</div>
            <h1>这份故事档案<br />已经不在这里了。</h1>
            <p>匿名项目只保留 7 天。你仍然可以查看完整示例，或从一句新创意重新开始。</p>
            <button className="primary-button" type="button" onClick={() => selectProject(sampleProject.id)}>查看完整示例</button>
          </section>
        )}
      </main>

      <CreateProjectModal
        open={modalOpen}
        busy={creating}
        seed={creationSeed}
        mode={creationMode}
        initial={creationInitial}
        onClose={() => !creating && setModalOpen(false)}
        onCreate={createProject}
      />
    </div>
  );
}
