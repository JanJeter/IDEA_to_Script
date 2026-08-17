import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  Check,
  FileText,
  GitBranch,
  MapPin,
  Radar,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { CreateProjectInput } from '../types';
import './LandingPage.css';

type CreationMode = 'original' | 'adaptation';

type Props = {
  busy?: boolean;
  onCreate: (input: CreateProjectInput) => Promise<void>;
  onOpenSample: () => void;
  onOpenTrends: () => void;
};

type SetupField = 'title' | 'genre' | 'tone';

type StageStepProps = {
  index: number;
  title: string;
  description: string;
  detail: string;
  reverse?: boolean;
  children: ReactNode;
};

const initialSetup = {
  title: '',
  genre: '',
  tone: '',
  targetMinutes: 8,
};

const finalFragments = Array.from({ length: 38 }, (_, index) => {
  const side = index % 2 === 0 ? -1 : 1;
  const row = Math.floor(index / 2);
  const distance = 18 + ((index * 23) % 32);
  return {
    x: `${side * distance}vw`,
    y: `${-31 + ((row * 17) % 64)}vh`,
    rotation: `${side * (12 + ((index * 19) % 64))}deg`,
    delay: `${(index % 9) * 24}ms`,
    shape: index % 5,
  };
});

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function useRevealOnce<T extends HTMLElement>(threshold = 0.34) {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setActive(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -16% 0px', threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, active };
}

function ProcessStep({ index, title, description, detail, reverse = false, children }: StageStepProps) {
  const { ref, active } = useRevealOnce<HTMLElement>();
  return (
    <article
      ref={ref}
      className={`process-step ${reverse ? 'process-step--reverse' : ''}`}
      data-active={active ? 'true' : undefined}
    >
      <div className="process-step-copy">
        <span className="process-step-number">{String(index).padStart(2, '0')}</span>
        <h3>{title}</h3>
        <p>{description}</p>
        <small>{detail}</small>
      </div>
      <div className="process-step-artifact">{children}</div>
      <i className="process-step-marker" aria-hidden="true" />
    </article>
  );
}

function Finale({ onStart, onOpenSample }: { onStart: () => void; onOpenSample: () => void }) {
  const { ref, active } = useRevealOnce<HTMLElement>(0.42);
  return (
    <section ref={ref} className="landing-finale" data-active={active ? 'true' : undefined}>
      <div className="finale-fragments" aria-hidden="true">
        {finalFragments.map((fragment, index) => (
          <i
            key={index}
            data-shape={fragment.shape}
            style={{
              '--fragment-x': fragment.x,
              '--fragment-y': fragment.y,
              '--fragment-r': fragment.rotation,
              '--fragment-delay': fragment.delay,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="finale-copy">
        <FileText size={25} strokeWidth={1.7} aria-hidden="true" />
        <h2>从故事内核开始，把下一步写清楚。</h2>
        <p>生成只是起点。每一层内容都可以修改、保存，再由你确认是否继续。</p>
        <div className="finale-actions">
          <button type="button" className="landing-primary" onClick={onStart}>开始写故事 <ArrowRight size={17} /></button>
          <button type="button" className="landing-secondary" onClick={onOpenSample}>查看完整示例</button>
        </div>
      </div>
    </section>
  );
}

export function LandingPage({ busy = false, onCreate, onOpenSample, onOpenTrends }: Props) {
  const [mode, setMode] = useState<CreationMode>('original');
  const [seed, setSeed] = useState('');
  const [hasAdaptationRights, setHasAdaptationRights] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState(initialSetup);
  const [seedError, setSeedError] = useState('');
  const [rightsError, setRightsError] = useState('');
  const [setupError, setSetupError] = useState('');
  const [invalidField, setInvalidField] = useState<SetupField | ''>('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rightsRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const genreRef = useRef<HTMLInputElement>(null);
  const toneRef = useRef<HTMLInputElement>(null);

  const prompt = mode === 'original'
    ? '例如：一个失眠的地铁维修工，收到七年前事故现场的求救广播。'
    : '粘贴故事梗概或章节素材，系统会先提炼适合短剧的冲突主线。';
  const maximumLength = mode === 'original' ? 1000 : 10000;
  const minimumLength = mode === 'original' ? 10 : 200;

  useEffect(() => {
    if (setupOpen) titleRef.current?.focus();
  }, [setupOpen]);

  function selectMode(nextMode: CreationMode) {
    setMode(nextMode);
    setSetupOpen(false);
    setSeedError('');
    setRightsError('');
    setSetupError('');
    setInvalidField('');
  }

  function validateSeed() {
    const value = seed.trim();
    if (value.length < minimumLength) {
      setSeedError(mode === 'original'
        ? '请至少写下 10 个字的故事创意。'
        : '请粘贴至少 200 个字的故事素材，便于提炼完整冲突。');
      setRightsError('');
      inputRef.current?.focus();
      return false;
    }
    if (value.length > maximumLength) {
      setSeedError(`当前内容超过 ${maximumLength.toLocaleString()} 字，请删减后继续。`);
      setRightsError('');
      inputRef.current?.focus();
      return false;
    }
    if (mode === 'adaptation' && !hasAdaptationRights) {
      setSeedError('');
      setRightsError('请先确认你拥有该素材的使用权，或该素材允许改编。');
      rightsRef.current?.focus();
      return false;
    }
    setSeedError('');
    setRightsError('');
    return true;
  }

  function openSetup() {
    if (!validateSeed()) return;
    setSetupOpen(true);
  }

  function focusInvalid(field: SetupField) {
    ({ title: titleRef, genre: genreRef, tone: toneRef }[field]).current?.focus();
  }

  async function createProject() {
    if (busy) return;
    if (!validateSeed()) return;
    const requiredFields: Array<[SetupField, string, string]> = [
      ['title', setup.title, '请给故事起一个项目名称。'],
      ['genre', setup.genre, '请填写故事类型。'],
      ['tone', setup.tone, '请描述你希望的气质与语调。'],
    ];
    const missing = requiredFields.find(([, value]) => !value.trim());
    if (missing) {
      setInvalidField(missing[0]);
      setSetupError(missing[2]);
      focusInvalid(missing[0]);
      return;
    }

    setInvalidField('');
    setSetupError('');
    const value = seed.trim();
    try {
      await onCreate({
        mode: mode === 'adaptation' ? 'ADAPTATION' : 'ORIGINAL',
        title: setup.title.trim(),
        logline: value.slice(0, 1000),
        sourceText: mode === 'adaptation' ? value : undefined,
        genre: setup.genre.trim(),
        tone: setup.tone.trim(),
        targetMinutes: setup.targetMinutes,
        language: 'zh-CN',
      });
    } catch (reason) {
      setSetupError(reason instanceof Error ? reason.message : '项目暂时无法创建，请稍后重试。');
    }
  }

  function submitComposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (setupOpen) {
      void createProject();
      return;
    }
    openSetup();
  }

  function updateSetup(field: SetupField, value: string) {
    setSetup((current) => ({ ...current, [field]: value }));
    if (invalidField === field) {
      setInvalidField('');
      setSetupError('');
    }
  }

  function focusComposer() {
    document.querySelector('#composer')?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'center',
    });
    inputRef.current?.focus({ preventScroll: true });
  }

  function returnToSeed() {
    setSetupOpen(false);
    setSetupError('');
    setInvalidField('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main-content">跳到主要内容</a>

      <header className="landing-nav">
        <button className="landing-wordmark" type="button" onClick={scrollToTop} aria-label="返回首页顶部">
          <span aria-hidden="true">IS</span>
          <strong>Idea to Screenplay</strong>
        </button>
        <nav aria-label="首页导航">
          <a href="#process">创作过程</a>
          <button type="button" onClick={onOpenTrends}>热点选题</button>
          <button type="button" onClick={onOpenSample}>完整示例</button>
        </nav>
        <button className="nav-start" type="button" onClick={focusComposer}>开始写故事</button>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p>中文短剧写作工作台</p>
            <h1 id="hero-title">
              <span>把一句想法，</span>
              <span>写成能继续改<br className="hero-mobile-break" />的剧本。</span>
            </h1>
            <div className="hero-lede">
              <span>先定故事</span><i />
              <span>再定人物和分场</span><i />
              <span>最后写动作与对白</span>
            </div>
          </div>

          <form
            className={`idea-composer ${setupOpen ? 'is-expanded' : ''}`}
            id="composer"
            onSubmit={submitComposer}
            aria-busy={busy}
            noValidate
          >
            <fieldset className="composer-modes">
              <legend className="sr-only">选择创作模式</legend>
              <label className={mode === 'original' ? 'active' : ''}>
                <input type="radio" name="creation-mode" value="original" checked={mode === 'original'} onChange={() => selectMode('original')} />
                <span>原创短剧</span>
              </label>
              <label className={mode === 'adaptation' ? 'active' : ''}>
                <input type="radio" name="creation-mode" value="adaptation" checked={mode === 'adaptation'} onChange={() => selectMode('adaptation')} />
                <span>网文改编</span>
              </label>
            </fieldset>

            <div className="composer-main">
              <label className="composer-input" htmlFor="story-seed">
                <span>{mode === 'original' ? '一句话故事创意' : '网文改编素材'}</span>
                <textarea
                  id="story-seed"
                  ref={inputRef}
                  value={seed}
                  rows={mode === 'original' ? 3 : 6}
                  maxLength={maximumLength}
                  placeholder={prompt}
                  aria-invalid={Boolean(seedError)}
                  aria-describedby={`composer-help${seedError ? ' composer-seed-error' : ''}`}
                  onChange={(event) => {
                    setSeed(event.target.value);
                    if (seedError) setSeedError('');
                  }}
                />
              </label>
              <button
                className="composer-continue"
                type="submit"
                aria-label="继续填写项目设置"
                aria-expanded={setupOpen}
                aria-controls="project-setup"
                disabled={busy}
              >
                继续 <ArrowRight size={18} />
              </button>
            </div>

            {seedError && <p className="composer-error" id="composer-seed-error" role="alert">{seedError}</p>}

            {mode === 'adaptation' && (
              <label className="adaptation-rights">
                <input
                  ref={rightsRef}
                  type="checkbox"
                  checked={hasAdaptationRights}
                  aria-invalid={Boolean(rightsError)}
                  aria-describedby={rightsError ? 'composer-rights-error' : undefined}
                  onChange={(event) => {
                    setHasAdaptationRights(event.target.checked);
                    if (rightsError) setRightsError('');
                  }}
                />
                <span>我拥有该素材的使用权，或该素材允许我进行改编。</span>
              </label>
            )}

            {rightsError && <p className="composer-error" id="composer-rights-error" role="alert">{rightsError}</p>}

            <div className="composer-meta" id="composer-help">
              <span>至少 {minimumLength} 字，当前 {seed.length.toLocaleString()} / {maximumLength.toLocaleString()}</span>
              <span>匿名项目保留 7 天</span>
            </div>

            {setupOpen && (
              <section
                className="creation-setup"
                id="project-setup"
                aria-labelledby="project-setup-title"
              >
                <header>
                  <div><span>下一步</span><h2 id="project-setup-title">补充项目设置</h2></div>
                  <button type="button" onClick={returnToSeed}>返回修改创意</button>
                </header>

                <div className="setup-grid">
                  <label className="setup-title-field">
                    <span>项目名称</span>
                    <input
                      id="project-title"
                      ref={titleRef}
                      value={setup.title}
                      maxLength={80}
                      placeholder="给这份故事起个名字"
                      aria-invalid={invalidField === 'title'}
                      aria-describedby={invalidField === 'title' ? 'project-setup-error' : undefined}
                      onChange={(event) => updateSetup('title', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>类型</span>
                    <input
                      id="project-genre"
                      ref={genreRef}
                      value={setup.genre}
                      maxLength={40}
                      placeholder="例如：现实悬疑"
                      aria-invalid={invalidField === 'genre'}
                      aria-describedby={invalidField === 'genre' ? 'project-setup-error' : undefined}
                      onChange={(event) => updateSetup('genre', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>目标时长</span>
                    <select value={setup.targetMinutes} onChange={(event) => setSetup((current) => ({ ...current, targetMinutes: Number(event.target.value) }))}>
                      <option value={3}>3 分钟</option>
                      <option value={5}>5 分钟</option>
                      <option value={8}>8 分钟</option>
                      <option value={12}>12 分钟</option>
                      <option value={20}>20 分钟</option>
                    </select>
                  </label>
                  <label className="setup-tone-field">
                    <span>气质与语调</span>
                    <input
                      id="project-tone"
                      ref={toneRef}
                      value={setup.tone}
                      maxLength={80}
                      placeholder="例如：克制、紧张，结尾留有希望"
                      aria-invalid={invalidField === 'tone'}
                      aria-describedby={invalidField === 'tone' ? 'project-setup-error' : undefined}
                      onChange={(event) => updateSetup('tone', event.target.value)}
                    />
                  </label>
                </div>

                {setupError && <p className="setup-error" id="project-setup-error" role="alert">{setupError}</p>}

                <footer>
                  <p><ShieldCheck size={16} />建立档案后，先生成故事内核，不会直接写完整剧本。</p>
                  <button type="submit" className="landing-primary" disabled={busy}>
                    {busy ? '正在创建…' : '创建故事档案'} {!busy && <ArrowRight size={17} />}
                  </button>
                </footer>
              </section>
            )}
          </form>

          <div className="hero-links">
            <button type="button" onClick={onOpenSample}>先查看一份完成的剧本</button>
            <button type="button" onClick={onOpenTrends}><Radar size={15} />从公开热点寻找灵感</button>
          </div>
        </section>

        <section className="process-section" id="process" aria-labelledby="process-title">
          <header className="process-heading">
            <div>
              <h2 id="process-title">不是一次提交，<br />是六次清楚的决定。</h2>
              <p>你可以在每一层停下来修改。确认后，下一阶段才会使用这份内容继续创作。</p>
            </div>
            <article className="sample-invite" id="sample" aria-label="《零点十七分》完整示例预览">
              <div><span>完整示例</span><strong>《零点十七分》</strong><small>6 个阶段，12 场，约 8 分钟</small></div>
              <button type="button" onClick={onOpenSample}>打开完整示例 <ArrowRight size={16} /></button>
            </article>
          </header>

          <div className="process-steps">
            <ProcessStep index={1} title="先把故事说清楚" description="确定前提、梗概和核心命题。方向不对时，只需要改这一层。" detail="可编辑，可保存，可重写">
              <div className="artifact artifact-editor">
                <header><span>故事内核</span><small><Check size={13} />修改已保存</small></header>
                <div><span>故事前提</span><p>一名失眠的地铁维修工，收到来自七年前事故现场的求救广播。</p></div>
                <div><span>核心命题</span><p>当真相会伤害仍活着的人，沉默还是责任吗？</p></div>
                <div className="artifact-footer"><span><RefreshCw size={13} />重写本阶段</span><strong><Save size={13} />保存修改</strong></div>
              </div>
            </ProcessStep>

            <ProcessStep index={2} reverse title="让人物之间产生力量" description="人物不只是档案。目标、阻力和关系共同决定下一场戏会发生什么。" detail="人物目标，人物弧光，关系方向">
              <div className="artifact artifact-cast">
                <header><Users size={17} /><span>人物关系</span><small>3 人</small></header>
                <div className="cast-row"><strong>顾言</strong><span>隐瞒事故记录</span><em>维修工</em></div>
                <div className="cast-connection"><i /><span>互相试探</span><i /></div>
                <div className="cast-row"><strong>林夏</strong><span>追查失踪广播</span><em>记者</em></div>
                <p><GitBranch size={14} />顾言的隐瞒会直接改变林夏的调查方向。</p>
              </div>
            </ProcessStep>

            <ProcessStep index={3} title="让空间参与叙事" description="地点不是背景说明。它需要影响人物行动，并留下可以反复使用的视觉线索。" detail="地点，氛围，反复出现的元素">
              <div className="artifact artifact-locations">
                <header><MapPin size={17} /><span>场景空间</span></header>
                <div><b>夜间控制室</b><span>冷白灯，旧设备持续发热</span><small>反复出现：延迟一秒的监视器</small></div>
                <div><b>封闭站台</b><span>潮湿，广播声没有回音</span><small>反复出现：停在 00:17 的电子钟</small></div>
              </div>
            </ProcessStep>

            <ProcessStep index={4} reverse title="先排节拍，再写分场" description="先检查冲突如何升级，再决定一场戏应该从哪里开始、在哪里结束。" detail="三幕结构，情绪变化，场景目的">
              <div className="artifact artifact-beats">
                <header><span>情节节拍</span><small>ACT II</small></header>
                <ol>
                  <li><i /><div><strong>广播再次出现</strong><span>怀疑 → 确认</span></div></li>
                  <li className="active"><i /><div><strong>监控记录被删改</strong><span>信任 → 对抗</span></div></li>
                  <li><i /><div><strong>林夏进入封闭站台</strong><span>主动 → 失控</span></div></li>
                </ol>
              </div>
            </ProcessStep>

            <ProcessStep index={5} title="每一场都有明确目的" description="地点、时长、对应节拍和场景意图放在一起审阅，删掉没有推动故事的场次。" detail="可逐场编辑，不必重写整篇">
              <div className="artifact artifact-scenes">
                <header><span>分场计划</span><small>12 场</small></header>
                <div><b>07</b><strong>内景 · 控制室 · 夜</strong><span>42 秒</span><p>顾言发现广播来自已经断电的旧线路。</p></div>
                <div className="selected"><b>08</b><strong>外景 · 封闭站台 · 夜</strong><span>58 秒</span><p>林夏找到事故当天遗留的工作证。</p></div>
                <div><b>09</b><strong>内景 · 设备间 · 夜</strong><span>65 秒</span><p>两人第一次正面核对各自隐瞒的信息。</p></div>
              </div>
            </ProcessStep>

            <ProcessStep index={6} reverse title="最后才写动作与对白" description="前五层确认后再汇编完整剧本。结果可以复制，也可以下载为 Fountain 文件继续修改。" detail="失败不覆盖旧稿，刷新可以恢复进度">
              <div className="artifact artifact-script">
                <header><span>零点十七分.fountain</span><small><Check size={13} />已保存</small></header>
                <pre>{`INT. 夜间控制室 - 深夜\n\n所有监视器同时跳过一帧。\n顾言停下笔，把声音推子拉到底。\n\n                    顾言\n          噪声不会准时回来。`}</pre>
                <div className="artifact-footer"><span><FileText size={14} />12 场</span><strong>下载 Fountain</strong></div>
              </div>
            </ProcessStep>
          </div>
        </section>

        <section className="trend-section" aria-labelledby="trend-title">
          <div><Radar size={21} strokeWidth={1.8} /><h2 id="trend-title">也可以从公开热点提取一个故事矛盾。</h2></div>
          <p>系统保留来源与风险状态，只提取社会张力。现实人物、机构、地点和原话不会进入生成内容。</p>
          <button type="button" className="landing-secondary" onClick={onOpenTrends}>打开热点选题台 <ArrowRight size={16} /></button>
        </section>

        <Finale onStart={focusComposer} onOpenSample={onOpenSample} />
      </main>

      <footer className="landing-footer">
        <div><strong>Idea to Screenplay</strong><span>给中文短剧创作者的分阶段写作工具</span></div>
        <p>匿名项目保留 7 天。AI 输出请在发布或拍摄前人工审阅。</p>
        <div><Sparkles size={15} /><span>作品重于界面，决定始终由你完成。</span></div>
      </footer>
    </div>
  );
}
