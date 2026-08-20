import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRight,
  BookOpenText,
  Check,
  Clipboard,
  Download,
  ExternalLink,
  FilePenLine,
  MapPin,
  Milestone,
  Play,
  RefreshCw,
  Radar,
  Save,
  ScrollText,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react';
import type {
  BeatDraft,
  CharacterDraft,
  CharacterRelationship,
  CharacterRelationshipDraft,
  GenerationEvent,
  LocationDraft,
  Project,
  Scene,
  ScenePlanDraft,
  StageKey,
} from '../types';

const CharacterGraph = lazy(() => import('./CharacterGraph'));

type Props = {
  project: Project;
  generating: boolean;
  readOnly?: boolean;
  progress: number;
  events: GenerationEvent[];
  onGenerate: () => void;
  onGenerateStage: (stage: StageKey) => Promise<void>;
  onConfirmStage: (stage: StageKey) => Promise<void>;
  onSaveStage: (stage: StageKey, content: Record<string, unknown>) => Promise<void>;
  onStartProject?: () => void;
  onSaveScene: (sceneId: string, input: Partial<Scene>) => Promise<void>;
};

const stages: Array<{ id: StageKey; label: string; icon: typeof Sparkles }> = [
  { id: 'PREMISE', label: '故事内核', icon: Sparkles },
  { id: 'CHARACTERS', label: '人物档案', icon: Users },
  { id: 'LOCATIONS', label: '场景空间', icon: MapPin },
  { id: 'BEATS', label: '情节节拍', icon: Milestone },
  { id: 'SCENES', label: '分场计划', icon: FilePenLine },
  { id: 'SCRIPT', label: '完整剧本', icon: ScrollText },
];

const stageOrder = stages.map(({ id }) => id);
type UserStageKey = 'STORY' | 'PLAN' | 'SCRIPT';
const userStages: Array<{ id: UserStageKey; label: string; description: string; icon: typeof Sparkles; stages: StageKey[] }> = [
  { id: 'STORY', label: '故事设定', description: '创意、人物与场景', icon: Sparkles, stages: ['PREMISE', 'CHARACTERS', 'LOCATIONS'] },
  { id: 'PLAN', label: '分场计划', description: '节拍与镜头安排', icon: FilePenLine, stages: ['BEATS', 'SCENES'] },
  { id: 'SCRIPT', label: '完整剧本', description: '对白、动作与导出', icon: ScrollText, stages: ['SCRIPT'] },
];
const nextStageLabel: Record<StageKey, string> = {
  PREMISE: '确认并生成人物',
  CHARACTERS: '确认并生成空间',
  LOCATIONS: '确认并生成节拍',
  BEATS: '确认并生成分场',
  SCENES: '确认并生成完整剧本',
  SCRIPT: '确认并替换当前稿',
};

export function Studio({
  project,
  generating,
  readOnly = false,
  progress,
  events,
  onGenerate,
  onGenerateStage,
  onConfirmStage,
  onSaveStage,
  onStartProject,
  onSaveScene,
}: Props) {
  const initialStage = project.draft?.currentStage;
  const [selectedStage, setSelectedStage] = useState<StageKey>(
    initialStage && initialStage !== 'IDEA' ? initialStage : project.status === 'READY' ? 'SCRIPT' : 'PREMISE',
  );

  useEffect(() => {
    const activeStage = generating ? project.currentStage : project.draft?.currentStage;
    if (activeStage && activeStage !== 'IDEA' && stageOrder.includes(activeStage as StageKey)) {
      setSelectedStage(activeStage as StageKey);
    } else if (!project.draft && project.status === 'READY') {
      setSelectedStage('SCRIPT');
    } else {
      setSelectedStage('PREMISE');
    }
  }, [generating, project.currentStage, project.draft, project.id, project.status]);

  const currentStage = (
    generating && stageOrder.includes(project.currentStage as StageKey)
      ? project.currentStage
      : project.draft?.currentStage
  ) as StageKey | 'IDEA' | undefined;
  const confirmedStage = project.draft?.confirmedStage ?? (project.status === 'READY' ? 'SCRIPT' : null);
  const currentConfirmed = Boolean(
    project.draft &&
      project.draft.currentStage !== 'IDEA' &&
      project.draft.currentStage === project.draft.confirmedStage,
  );

  const available = (stage: StageKey) => {
    if (readOnly || (!project.draft && project.status === 'READY')) return true;
    if (stage === 'PREMISE' && (!project.draft || project.draft.currentStage === 'IDEA')) return true;
    if (generating && project.currentStage === stage) return true;
    return hasStageContent(project, stage);
  };

  const mastheadAction = () => {
    if (readOnly) return onStartProject?.();
    if (generating) return;
    if (!project.draft) return onGenerate();
    if (project.draft.currentStage === 'IDEA') {
      return void onGenerateStage('PREMISE').catch(() => undefined);
    }
    if (currentConfirmed) {
      return void onConfirmStage(project.draft.currentStage).catch(() => undefined);
    }
    if (!window.confirm(`重新生成${stageLabel(project.draft.currentStage)}会替换当前未确认内容，继续吗？`)) return;
    return void onGenerateStage(project.draft.currentStage).catch(() => undefined);
  };

  const mastheadLabel = readOnly
    ? '写我的故事'
    : generating
      ? '正在创作'
      : !project.draft
        ? project.status === 'READY'
          ? '新建改稿'
          : '生成故事内核'
        : project.draft.currentStage === 'IDEA'
          ? '重试故事内核'
            : currentConfirmed
            ? '继续下一阶段'
            : '重写当前阶段';
  const selectedUserStage = userStages.find(({ stages: groupedStages }) => groupedStages.includes(selectedStage)) ?? userStages[0];
  const selectUserStage = (userStage: UserStageKey) => {
    const group = userStages.find(({ id }) => id === userStage) ?? userStages[0];
    const current = group.stages.find((stage) => stage === currentStage);
    const nextAvailable = group.stages.find((stage) => available(stage));
    setSelectedStage(current ?? nextAvailable ?? group.stages[0]);
  };

  return (
    <div className="studio">
      <section className="story-masthead">
        <div className="masthead-number">{String(project.targetMinutes).padStart(2, '0')}′</div>
        <div className="masthead-copy">
          <div className="eyebrow">
            {readOnly && <span className="sample-badge">完整示例</span>}
            {project.genre} / {project.tone}
          </div>
          <h1>{project.title}</h1>
          <p>{project.logline}</p>
          {project.mode === 'TREND_INSPIRED' && project.trendTopic && (
            <a className="trend-project-origin" href={project.trendTopic.sourceUrl} target="_blank" rel="noreferrer">
              <Radar size={13} /> 灵感信号：{project.trendTopic.title}
              <span>{project.trendTopic.sourceLabel}</span><ExternalLink size={12} />
            </a>
          )}
        </div>
        <button
          type="button"
          className="generate-button"
          onClick={mastheadAction}
          disabled={generating}
        >
          {generating ? (
            <span className="spinner" />
          ) : readOnly ? (
            <ArrowRight size={16} />
          ) : project.draft ? (
            <RefreshCw size={16} />
          ) : (
            <Play size={16} fill="currentColor" />
          )}
          <span>{mastheadLabel}</span>
        </button>
      </section>

      <Pipeline
        currentStage={currentStage}
        confirmedStage={confirmedStage}
        selectedStage={selectedStage}
        selectedUserStage={selectedUserStage.id}
        progress={progress}
        generating={generating}
        available={available}
        onSelect={selectUserStage}
      />

      {events.length > 0 && generating && (
        <div className="live-note" aria-live="polite">
          <span className="live-dot" />
          <span>{events[events.length - 1]?.message}</span>
          <strong>{progress}%</strong>
        </div>
      )}

      <div className="workbench">
        <nav className="view-tabs" aria-label="三阶段编剧工作台">
          {userStages.map(({ id, label, icon: Icon }, index) => (
            <button
              type="button"
              key={id}
              className={selectedUserStage.id === id ? 'active' : ''}
              disabled={!userStages.find((group) => group.id === id)?.stages.some((stage) => available(stage))}
              onClick={() => selectUserStage(id)}
            >
              <span className="tab-index">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {selectedUserStage.stages.length > 1 && (
          <nav className="stage-subtabs" aria-label={`${selectedUserStage.label}内部内容`}>
            {selectedUserStage.stages.map((id) => {
              const stage = stages.find((item) => item.id === id)!;
              return (
                <button type="button" key={id} className={selectedStage === id ? 'active' : ''} disabled={!available(id)} onClick={() => setSelectedStage(id)}>
                  {stage.label}
                </button>
              );
            })}
          </nav>
        )}

        <div className="workbench-content">
          {!available(selectedStage) ? (
            <EmptySection
              icon={stages.find(({ id }) => id === selectedStage)?.icon ?? Sparkles}
              text="确认上一阶段后，这里会开始生成。"
            />
          ) : project.draft && hasStageContent(project, selectedStage) ? (
            <DraftStageEditor
              key={`${project.draft.id}-${project.draft.updatedAt}-${selectedStage}`}
              project={project}
              stage={selectedStage}
              editable={
                !readOnly &&
                !generating &&
                project.draft.currentStage === selectedStage &&
                project.draft.confirmedStage !== selectedStage
              }
              continuable={
                !readOnly &&
                !generating &&
                currentConfirmed &&
                project.draft.currentStage === selectedStage
              }
              generating={generating && project.currentStage === selectedStage}
              onSave={onSaveStage}
              onConfirm={onConfirmStage}
              onRegenerate={onGenerateStage}
            />
          ) : generating && project.currentStage === selectedStage ? (
            <GeneratingStage stage={selectedStage} />
          ) : project.draft?.currentStage === 'IDEA' && selectedStage === 'PREMISE' ? (
            <BlankStage onGenerate={() => void onGenerateStage('PREMISE')} retry />
          ) : (
            <ActiveStage
              project={project}
              stage={selectedStage}
              readOnly={readOnly}
              onGenerate={onGenerate}
              onSaveScene={onSaveScene}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function Pipeline({
  currentStage,
  confirmedStage,
  selectedStage,
  selectedUserStage,
  progress,
  generating,
  available,
  onSelect,
}: {
  currentStage?: StageKey | 'IDEA';
  confirmedStage: StageKey | null;
  selectedStage: StageKey;
  selectedUserStage: UserStageKey;
  progress: number;
  generating: boolean;
  available: (stage: StageKey) => boolean;
  onSelect: (stage: UserStageKey) => void;
}) {
  const confirmedIndex = confirmedStage ? stageOrder.indexOf(confirmedStage) : -1;
  return (
    <section className="pipeline pipeline--compact" aria-label="三阶段生成流水线">
      <div className="pipeline-rule"><span style={{ width: `${progress}%` }} /></div>
      {userStages.map(({ id, label, stages: groupedStages }, index) => {
        const complete = confirmedIndex >= stageOrder.indexOf(groupedStages[groupedStages.length - 1]);
        const active = groupedStages.includes(currentStage as StageKey);
        const selected = selectedUserStage === id || groupedStages.includes(selectedStage);
        const enabled = groupedStages.some((stage) => available(stage));
        return (
          <button
            type="button"
            className={`pipeline-stage ${complete ? 'complete' : ''} ${active ? 'active' : ''} ${selected ? 'selected' : ''}`}
            key={id}
            disabled={!enabled}
            onClick={() => onSelect(id)}
          >
            <span className="stage-dot">{complete ? <Check size={12} /> : index + 1}</span>
            <span>{label}</span>
            {active && <small>{generating ? '生成中' : complete ? '已确认' : '进行中'}</small>}
          </button>
        );
      })}
    </section>
  );
}

function GeneratingStage({ stage }: { stage: StageKey }) {
  const { icon: Icon, label } = stages.find(({ id }) => id === stage) ?? stages[0];
  return (
    <div className="stage-generating" aria-live="polite">
      <Icon size={27} strokeWidth={1.4} />
      <h2>正在生成{label}</h2>
      <p>任务在后台继续执行。刷新页面后仍会恢复当前进度，已经确认的内容不会被覆盖。</p>
      <div className="stage-skeleton"><span /><span /><span /></div>
    </div>
  );
}

function DraftStageEditor({
  project,
  stage,
  editable,
  continuable,
  generating,
  onSave,
  onConfirm,
  onRegenerate,
}: {
  project: Project;
  stage: StageKey;
  editable: boolean;
  continuable: boolean;
  generating: boolean;
  onSave: Props['onSaveStage'];
  onConfirm: Props['onConfirmStage'];
  onRegenerate: Props['onGenerateStage'];
}) {
  const [content, setContent] = useState<Record<string, unknown>>(() => stageContent(project, stage));
  const [busy, setBusy] = useState<'save' | 'confirm' | 'regenerate' | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy('save');
    setError('');
    try {
      await onSave(stage, content);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试');
      throw reason;
    } finally {
      setBusy(null);
    }
  }

  async function saveAndConfirm() {
    setBusy('confirm');
    setError('');
    try {
      await onSave(stage, content);
      await onConfirm(stage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认失败，请重试');
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!window.confirm(`重新生成${stageLabel(stage)}会替换当前未确认内容，已确认阶段不受影响。继续吗？`)) return;
    setBusy('regenerate');
    setError('');
    try {
      await onRegenerate(stage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重新生成失败，请重试');
    } finally {
      setBusy(null);
    }
  }

  async function continueToNext() {
    setBusy('confirm');
    setError('');
    try {
      await onConfirm(stage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '继续生成失败，请重试');
      setBusy(null);
    }
  }

  return (
    <section className="stage-review">
      <header className="stage-review-header">
        <div>
          <span>{stageLabel(stage)}</span>
          <h2>{editable ? '审阅并修改本阶段' : '已确认阶段'}</h2>
        </div>
        <p>{stagePurpose(stage)}</p>
      </header>

      <StageFields stage={stage} content={content} editable={editable} onChange={setContent} />

      {error && <p className="stage-inline-error" role="alert">{error}</p>}
      <footer className="stage-actions">
        <div>
          <strong>{editable ? '等待你的确认' : continuable ? '内容已经确认' : '此阶段已锁定'}</strong>
          <span>{editable ? '保存后再进入下一阶段，后续内容会以这里为依据。' : continuable ? '可以继续生成下一阶段，已经确认的内容不会被修改。' : '可继续查看，当前生成不会修改这份内容。'}</span>
        </div>
        {editable && (
          <>
            <button type="button" className="secondary-action" onClick={() => void regenerate()} disabled={Boolean(busy) || generating}>
              <RefreshCw size={15} />{busy === 'regenerate' ? '正在提交' : '重写本阶段'}
            </button>
            <button type="button" className="secondary-action" onClick={() => void save()} disabled={Boolean(busy)}>
              {saved ? <Check size={15} /> : <Save size={15} />}{saved ? '已保存' : busy === 'save' ? '保存中' : '保存修改'}
            </button>
            <button type="button" className="primary-action" onClick={() => void saveAndConfirm()} disabled={Boolean(busy)}>
              {busy === 'confirm' ? <span className="spinner" /> : <ArrowRight size={15} />}
              {nextStageLabel[stage]}
            </button>
          </>
        )}
        {continuable && (
          <button type="button" className="primary-action" onClick={() => void continueToNext()} disabled={Boolean(busy)}>
            {busy === 'confirm' ? <span className="spinner" /> : <ArrowRight size={15} />}
            {nextStageLabel[stage]}
          </button>
        )}
      </footer>
    </section>
  );
}

function StageFields({
  stage,
  content,
  editable,
  onChange,
}: {
  stage: StageKey;
  content: Record<string, unknown>;
  editable: boolean;
  onChange: (content: Record<string, unknown>) => void;
}) {
  const update = (key: string, value: unknown) => onChange({ ...content, [key]: value });

  if (stage === 'PREMISE') {
    return (
      <div className="stage-form premise-form">
        <ReviewField label="项目标题" value={String(content.title ?? '')} editable={editable} onChange={(value) => update('title', value)} />
        <ReviewField label="故事前提" value={String(content.premise ?? '')} editable={editable} rows={4} onChange={(value) => update('premise', value)} />
        <ReviewField label="故事梗概" value={String(content.synopsis ?? '')} editable={editable} rows={8} onChange={(value) => update('synopsis', value)} />
        <ReviewField label="核心命题" value={String(content.theme ?? '')} editable={editable} rows={3} onChange={(value) => update('theme', value)} />
      </div>
    );
  }

  if (stage === 'CHARACTERS') {
    const characters = (content.characters ?? []) as CharacterDraft[];
    const relationships = (content.relationships ?? []) as CharacterRelationshipDraft[];
    return (
      <CharacterReviewFields
        characters={characters}
        relationships={relationships}
        editable={editable}
        onCharactersChange={(items) => update('characters', items)}
      />
    );
  }

  if (stage === 'LOCATIONS') {
    const locations = (content.locations ?? []) as LocationDraft[];
    return (
      <CollectionEditor
        items={locations}
        itemName="空间"
        editable={editable}
        onChange={(items) => update('locations', items)}
        render={(location, index, change) => (
          <>
            <ReviewField label="地点名称" value={location.name} editable={editable} onChange={(value) => change({ ...location, name: value })} />
            <ReviewField label="空间描述" value={location.description} editable={editable} rows={4} onChange={(value) => change({ ...location, description: value })} />
            <div className="review-row two-columns">
              <ReviewField label="氛围" value={location.atmosphere} editable={editable} rows={3} onChange={(value) => change({ ...location, atmosphere: value })} />
              <ReviewField label="反复出现的元素" value={location.recurringElements} editable={editable} rows={3} onChange={(value) => change({ ...location, recurringElements: value })} />
            </div>
            <span className="collection-folio">{String(index + 1).padStart(2, '0')}</span>
          </>
        )}
      />
    );
  }

  if (stage === 'BEATS') {
    const beats = (content.beats ?? []) as BeatDraft[];
    return (
      <CollectionEditor
        items={beats}
        itemName="节拍"
        editable={editable}
        onChange={(items) => update('beats', items)}
        render={(beat, index, change) => (
          <>
            <div className="review-row compact-row">
              <ReviewField label="幕" value={String(beat.act)} editable={editable} inputMode="numeric" onChange={(value) => change({ ...beat, act: Number(value) || 1 })} />
              <ReviewField label="序号" value={String(index + 1)} editable={false} onChange={() => undefined} />
              <ReviewField label="标题" value={beat.title} editable={editable} onChange={(value) => change({ ...beat, title: value })} />
            </div>
            <ReviewField label="情节摘要" value={beat.summary} editable={editable} rows={4} onChange={(value) => change({ ...beat, summary: value })} />
            <ReviewField label="情绪变化" value={beat.emotionalShift} editable={editable} onChange={(value) => change({ ...beat, emotionalShift: value })} />
          </>
        )}
      />
    );
  }

  if (stage === 'SCENES') {
    const scenes = (content.scenes ?? []) as ScenePlanDraft[];
    return (
      <ScenePlanTable
        scenes={scenes}
        editable={editable}
        onChange={(items) => update('scenes', items)}
      />
    );
  }

  return (
    <div className="script-draft-editor">
      <label>
        <span>FOUNTAIN 剧本正文</span>
        <textarea
          value={String(content.scriptText ?? '')}
          readOnly={!editable}
          rows={34}
          onChange={(event) => update('scriptText', event.target.value)}
        />
      </label>
    </div>
  );
}

function CharacterReviewFields({
  characters,
  relationships,
  editable,
  onCharactersChange,
}: {
  characters: CharacterDraft[];
  relationships: CharacterRelationshipDraft[];
  editable: boolean;
  onCharactersChange: (characters: CharacterDraft[]) => void;
}) {
  const [view, setView] = useState<'profiles' | 'graph'>('profiles');

  return (
    <div className="character-review-fields">
      <nav className="character-view-switcher" aria-label="人物评审视图">
        <span>人物阶段审阅</span>
        <button type="button" className={view === 'profiles' ? 'active' : ''} onClick={() => setView('profiles')}><Users size={15} />人物档案</button>
        <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><Waypoints size={15} />关系图谱</button>
      </nav>
      {view === 'graph' ? (
        <Suspense fallback={<div className="graph-loading"><span className="spinner" /><p>正在铺开人物关系…</p></div>}>
          <CharacterGraph characters={characters} relationships={relationships} />
        </Suspense>
      ) : (
        <CollectionEditor
          items={characters}
          itemName="人物"
          editable={editable}
          onChange={onCharactersChange}
          render={(character, index, change) => (
            <>
              <div className="review-row">
                <ReviewField label="姓名" value={character.name} editable={editable} onChange={(value) => change({ ...character, name: value })} />
                <ReviewField label="角色" value={character.role} editable={editable} onChange={(value) => change({ ...character, role: value })} />
                <ReviewField label="年龄" value={character.age ?? ''} editable={editable} onChange={(value) => change({ ...character, age: value })} />
              </div>
              <ReviewField label="人物描述" value={character.description} editable={editable} rows={3} onChange={(value) => change({ ...character, description: value })} />
              <div className="review-row two-columns">
                <ReviewField label="想要" value={character.goal} editable={editable} rows={3} onChange={(value) => change({ ...character, goal: value })} />
                <ReviewField label="阻力" value={character.conflict} editable={editable} rows={3} onChange={(value) => change({ ...character, conflict: value })} />
              </div>
              <div className="review-row two-columns">
                <ReviewField label="人物弧光" value={character.arc} editable={editable} rows={3} onChange={(value) => change({ ...character, arc: value })} />
                <ReviewField label="说话方式" value={character.voice} editable={editable} rows={3} onChange={(value) => change({ ...character, voice: value })} />
              </div>
              <span className="collection-folio">{String(index + 1).padStart(2, '0')}</span>
            </>
          )}
        />
      )}
    </div>
  );
}

function ReviewField({
  label,
  value,
  editable,
  rows,
  inputMode,
  onChange,
}: {
  label: string;
  value: string;
  editable: boolean;
  rows?: number;
  inputMode?: 'numeric';
  onChange: (value: string) => void;
}) {
  return (
    <label className="review-field">
      <span>{label}</span>
      {rows ? (
        <textarea value={value} rows={rows} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input value={value} inputMode={inputMode} readOnly={!editable} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function CollectionEditor<Item>({
  items,
  itemName,
  editable,
  onChange,
  render,
}: {
  items: Item[];
  itemName: string;
  editable: boolean;
  onChange: (items: Item[]) => void;
  render: (item: Item, index: number, change: (item: Item) => void) => ReactNode;
}) {
  return (
    <div className="review-collection">
      {items.map((item, index) => (
        <article key={index} className="review-collection-item">
          <header><span>{itemName} {String(index + 1).padStart(2, '0')}</span></header>
          {render(item, index, (changed) => {
            if (!editable) return;
            onChange(items.map((current, itemIndex) => (itemIndex === index ? changed : current)));
          })}
        </article>
      ))}
    </div>
  );
}

function ScenePlanTable({
  scenes,
  editable,
  onChange,
}: {
  scenes: ScenePlanDraft[];
  editable: boolean;
  onChange: (scenes: ScenePlanDraft[]) => void;
}) {
  function update(index: number, patch: Partial<ScenePlanDraft>) {
    if (!editable) return;
    onChange(scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene));
  }

  return (
    <div className="scene-plan-table-wrap">
      <div className="scene-plan-table-meta">
        <div>
          <strong>分场计划</strong>
          <span>{scenes.length} 个镜头 · 按顺序确认画面节奏</span>
        </div>
        <span>{editable ? '点击单元格直接修改' : '只读示例'}</span>
      </div>
      <div className="scene-plan-table-scroll">
        <table className="scene-plan-table">
          <thead>
            <tr>
              <th scope="col">镜号</th>
              <th scope="col">时长</th>
              <th scope="col">画面与动作</th>
              <th scope="col">场景信息</th>
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene, index) => (
              <tr key={`${scene.sceneNumber}-${index}`}>
                <th scope="row">E{String(scene.beatSequence).padStart(2, '0')}S{String(scene.sceneNumber).padStart(2, '0')}</th>
                <td>
                  {editable ? (
                    <input
                      className="scene-plan-duration"
                      aria-label={`第 ${index + 1} 个镜头时长`}
                      inputMode="numeric"
                      value={scene.estimatedSeconds}
                      onChange={(event) => update(index, { estimatedSeconds: Number(event.target.value) || 0 })}
                    />
                  ) : scene.estimatedSeconds}
                  <span className="scene-plan-unit">s</span>
                </td>
                <td className="scene-plan-description">
                  {editable ? (
                    <>
                      <input
                        aria-label={`第 ${index + 1} 个镜头标题`}
                        value={scene.heading}
                        onChange={(event) => update(index, { heading: event.target.value })}
                      />
                      <textarea
                        aria-label={`第 ${index + 1} 个镜头画面描述`}
                        rows={3}
                        value={scene.summary}
                        onChange={(event) => update(index, { summary: event.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <strong>{scene.heading}</strong>
                      <p>{scene.summary}</p>
                    </>
                  )}
                </td>
                <td className="scene-plan-context">
                  {editable ? (
                    <>
                      <input
                        aria-label={`第 ${index + 1} 个镜头地点`}
                        value={scene.location}
                        onChange={(event) => update(index, { location: event.target.value })}
                      />
                      <input
                        aria-label={`第 ${index + 1} 个镜头时间`}
                        value={scene.timeOfDay}
                        onChange={(event) => update(index, { timeOfDay: event.target.value })}
                      />
                    </>
                  ) : (
                    <>
                      <strong>{scene.location}</strong>
                      <span>{scene.timeOfDay}</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActiveStage({
  project,
  stage,
  readOnly,
  onGenerate,
  onSaveScene,
}: {
  project: Project;
  stage: StageKey;
  readOnly: boolean;
  onGenerate: () => void;
  onSaveScene: Props['onSaveScene'];
}) {
  if (stage === 'PREMISE') {
    if (!project.premise) return <BlankStage onGenerate={onGenerate} />;
    return (
      <div className="overview-grid">
        <article className="editorial-card premise-card"><span className="card-label">故事前提</span><h2>{project.premise}</h2></article>
        <article className="editorial-card synopsis-card"><span className="card-label">故事梗概</span><p>{project.synopsis}</p></article>
        <article className="editorial-card theme-card"><span className="card-label">核心命题</span><blockquote>“{project.theme}”</blockquote></article>
      </div>
    );
  }
  if (stage === 'CHARACTERS') {
    return <Characters characters={project.characters} relationships={project.relationships ?? []} />;
  }
  if (stage === 'LOCATIONS') return <Locations locations={project.locations} />;
  if (stage === 'BEATS') return <Structure beats={project.beats} />;
  if (stage === 'SCENES') return <Scenes project={project} readOnly={readOnly} onSave={onSaveScene} />;
  return <Screenplay project={project} />;
}

function BlankStage({ onGenerate, retry = false }: { onGenerate: () => void; retry?: boolean }) {
  return (
    <div className="blank-sheet">
      <span className="blank-sheet-number">01</span>
      <Sparkles size={28} strokeWidth={1.4} />
      <h2>{retry ? '重新生成故事内核' : '先生成故事内核'}</h2>
      <p>{retry ? '上一次任务没有完成，已确认内容仍然安全。可以从故事内核重新开始。' : '系统只生成当前阶段。你可以修改并确认后，再让人物和后续结构继续发展。'}</p>
      <button className="text-button" type="button" onClick={onGenerate}>{retry ? '重试故事内核' : '生成故事内核'} <span>→</span></button>
    </div>
  );
}

function Characters({
  characters,
  relationships,
}: {
  characters: CharacterDraft[];
  relationships: Array<CharacterRelationship | CharacterRelationshipDraft>;
}) {
  const [view, setView] = useState<'profiles' | 'graph'>('profiles');
  if (!characters.length) return <EmptySection icon={Users} text="人物档案会在第二阶段出现。" />;
  return (
    <div className="character-section">
      <nav className="character-view-switcher" aria-label="人物视图">
        <span>人物工作台</span>
        <button type="button" className={view === 'profiles' ? 'active' : ''} onClick={() => setView('profiles')}><Users size={15} />人物档案</button>
        <button type="button" className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><Waypoints size={15} />关系图谱</button>
      </nav>
      {view === 'graph' ? (
        <Suspense fallback={<div className="graph-loading"><span className="spinner" /><p>正在铺开人物关系…</p></div>}>
          <CharacterGraph characters={characters} relationships={relationships} />
        </Suspense>
      ) : (
        <div className="character-grid">
          {characters.map((character, index) => (
            <article className="character-card" key={`${character.name}-${index}`}>
              <div className="character-card-top"><span>{String(index + 1).padStart(2, '0')}</span><span>{character.role}</span></div>
              <h2>{character.name}</h2>
              <p className="character-description">{character.description}</p>
              <dl>
                <div><dt>想要</dt><dd>{character.goal}</dd></div>
                <div><dt>阻力</dt><dd>{character.conflict}</dd></div>
                <div><dt>弧光</dt><dd>{character.arc}</dd></div>
                <div><dt>声音</dt><dd>{character.voice}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Locations({ locations }: { locations: LocationDraft[] }) {
  if (!locations.length) return <EmptySection icon={MapPin} text="场景空间会在第三阶段出现。" />;
  return (
    <div className="location-board">
      {locations.map((location, index) => (
        <article key={`${location.name}-${index}`}>
          <span>{String(index + 1).padStart(2, '0')}</span>
          <h2>{location.name}</h2>
          <p>{location.description}</p>
          <dl><dt>氛围</dt><dd>{location.atmosphere}</dd><dt>视觉母题</dt><dd>{location.recurringElements}</dd></dl>
        </article>
      ))}
    </div>
  );
}

function Structure({ beats }: { beats: BeatDraft[] }) {
  const acts = useMemo(() => [1, 2, 3].map((act) => beats.filter((beat) => beat.act === act)), [beats]);
  if (!beats.length) return <EmptySection icon={Milestone} text="情节节拍会在第四阶段出现。" />;
  return (
    <div className="acts-board">
      {acts.map((actBeats, actIndex) => (
        <section className="act-column" key={actIndex}>
          <header><span>ACT {['I', 'II', 'III'][actIndex]}</span><strong>{['建立', '对抗', '改变'][actIndex]}</strong></header>
          {actBeats.map((beat) => (
            <article className="beat-card" key={beat.sequence}>
              <span className="beat-number">{String(beat.sequence).padStart(2, '0')}</span>
              <h3>{beat.title}</h3><p>{beat.summary}</p><small>{beat.emotionalShift}</small>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

function Scenes({ project, readOnly, onSave }: { project: Project; readOnly: boolean; onSave: Props['onSaveScene'] }) {
  const [selectedId, setSelectedId] = useState(project.scenes[0]?.id);
  const selected = project.scenes.find((scene) => scene.id === selectedId) ?? project.scenes[0];
  const firstSceneId = project.scenes[0]?.id;

  useEffect(() => setSelectedId(firstSceneId), [project.id, firstSceneId]);

  if (!selected) return <EmptySection icon={FilePenLine} text="分场计划会在第五阶段出现。" />;
  return (
    <div className="scene-workspace">
      <div className="scene-strip">
        {project.scenes.map((scene) => (
          <button type="button" key={scene.id} className={scene.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(scene.id)}>
            <span>{String(scene.sceneNumber).padStart(2, '0')}</span><strong>{scene.location}</strong><small>{Math.round(scene.estimatedSeconds / 6) / 10} min</small>
          </button>
        ))}
      </div>
      <SceneEditor key={selected.id} scene={selected} readOnly={readOnly} onSave={onSave} />
    </div>
  );
}

function SceneEditor({ scene, readOnly, onSave }: { scene: Scene; readOnly: boolean; onSave: Props['onSaveScene'] }) {
  const [heading, setHeading] = useState(scene.heading);
  const [summary, setSummary] = useState(scene.summary);
  const [action, setAction] = useState(scene.action);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(scene.id, { heading, summary, action });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="scene-page">
      <div className="scene-page-toolbar">
        <span>SCENE {String(scene.sceneNumber).padStart(2, '0')}</span>
        {readOnly ? <span>只读示例</span> : <button type="button" onClick={() => void save()} disabled={saving}>{saved ? <Check size={15} /> : <Save size={15} />}{saved ? '已保存' : saving ? '保存中' : '保存修改'}</button>}
      </div>
      <ReviewField label="场景标题" value={heading} editable={!readOnly} onChange={setHeading} />
      <ReviewField label="场景意图" value={summary} editable={!readOnly} rows={3} onChange={setSummary} />
      <ReviewField label="动作描述" value={action} editable={!readOnly} rows={8} onChange={setAction} />
      <div className="dialogue-block">
        <span className="field-caption">对白</span>
        {scene.dialogue.map((line, index) => (
          <div className="dialogue-line" key={`${line.character}-${index}`}><strong>{line.character}</strong>{line.parenthetical && <em>（{line.parenthetical}）</em>}<p>{line.text}</p></div>
        ))}
      </div>
    </article>
  );
}

function Screenplay({ project }: { project: Project }) {
  const [copied, setCopied] = useState(false);
  if (!project.scriptText) return <EmptySection icon={BookOpenText} text="完整剧本会在最后一个阶段出现。" />;

  function download() {
    const blob = new Blob([project.scriptText ?? ''], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${project.title}.fountain`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function copy() {
    await navigator.clipboard.writeText(project.scriptText ?? '');
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="screenplay-view">
      <div className="screenplay-actions">
        <div><strong>FOUNTAIN DRAFT</strong><span>{project.scenes.length} SCENES</span></div>
        <button type="button" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Clipboard size={15} />}{copied ? '已复制' : '复制'}</button>
        <button type="button" onClick={download}><Download size={15} />下载 .fountain</button>
      </div>
      <pre className="screenplay-paper">{project.scriptText}</pre>
    </div>
  );
}

function stageContent(project: Project, stage: StageKey): Record<string, unknown> {
  const draft = project.draft;
  if (!draft) return {};
  if (stage === 'PREMISE') return { title: draft.title, premise: draft.premise, synopsis: draft.synopsis, theme: draft.theme };
  if (stage === 'CHARACTERS') {
    return { characters: draft.characters ?? [], relationships: draft.relationships ?? [] };
  }
  if (stage === 'LOCATIONS') return { locations: draft.locations ?? [] };
  if (stage === 'BEATS') return { beats: draft.beats ?? [] };
  if (stage === 'SCENES') return { scenes: draft.scenePlans ?? [] };
  return { scriptText: draft.scriptText ?? '' };
}

function hasStageContent(project: Project, stage: StageKey) {
  const draft = project.draft;
  if (!draft) {
    if (stage === 'PREMISE') return Boolean(project.premise);
    if (stage === 'CHARACTERS') return project.characters.length > 0;
    if (stage === 'LOCATIONS') return project.locations.length > 0;
    if (stage === 'BEATS') return project.beats.length > 0;
    if (stage === 'SCENES') return project.scenes.length > 0;
    return Boolean(project.scriptText);
  }
  if (stage === 'PREMISE') return Boolean(draft.premise);
  if (stage === 'CHARACTERS') return Boolean(draft.characters?.length);
  if (stage === 'LOCATIONS') return Boolean(draft.locations?.length);
  if (stage === 'BEATS') return Boolean(draft.beats?.length);
  if (stage === 'SCENES') return Boolean(draft.scenePlans?.length);
  return Boolean(draft.scriptText);
}

function stageLabel(stage: StageKey) {
  return stages.find(({ id }) => id === stage)?.label ?? stage;
}

function stagePurpose(stage: StageKey) {
  return {
    PREMISE: '确定故事前提、梗概和核心命题。',
    CHARACTERS: '检查每个人物的目标、阻力、弧光和说话方式。',
    LOCATIONS: '确认地点是否可拍，并让空间承担叙事作用。',
    BEATS: '检查三幕推进、冲突升级和情绪变化。',
    SCENES: '确认每一场的目的、地点、时长和对应节拍。',
    SCRIPT: '审阅 Fountain 初稿，确认后才替换项目当前稿。',
  }[stage];
}

function EmptySection({ icon: Icon, text }: { icon: typeof Users; text: string }) {
  return <div className="section-empty"><Icon size={26} strokeWidth={1.3} /><p>{text}</p></div>;
}
