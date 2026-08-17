import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Clapperboard,
  FileText,
  GitBranch,
  PenLine,
  Radar,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import './LandingPage.css';

type CreationMode = 'original' | 'adaptation';

type Props = {
  onStart: (seed: string, mode: CreationMode) => void;
  onOpenSample: () => void;
  onOpenTrends: () => void;
};

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
};

const stages = [
  { name: '故事内核', description: '确定前提、梗概与核心命题。' },
  { name: '人物', description: '建立目标、阻力、人物弧光与关系网络。' },
  { name: '空间', description: '定义关键地点、氛围与视觉母题。' },
  { name: '情节节拍', description: '用三幕结构安排情绪、冲突与转折。' },
  { name: '分场', description: '把节拍拆成可以继续编辑的场景计划。' },
  { name: '完整剧本', description: '补全动作和对白，汇编可导出的初稿。' },
];

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ScrollReveal({ children, className = '', delay = 0 }: ScrollRevealProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setRevealed(true);
      observer.disconnect();
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.15 });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={elementRef}
      className={`scroll-reveal ${className}`.trim()}
      data-revealed={revealed ? 'true' : undefined}
      style={{ '--reveal-delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function LandingPage({ onStart, onOpenSample, onOpenTrends }: Props) {
  const [mode, setMode] = useState<CreationMode>('original');
  const [seed, setSeed] = useState('');
  const [hasAdaptationRights, setHasAdaptationRights] = useState(false);
  const [seedError, setSeedError] = useState('');
  const [rightsError, setRightsError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rightsRef = useRef<HTMLInputElement>(null);

  const prompt = mode === 'original'
    ? '例如：一个失眠的地铁维修工，收到七年前事故现场的求救广播……'
    : '粘贴故事梗概或章节素材，系统会先提炼适合短剧的冲突主线……';
  const maximumLength = mode === 'original' ? 1000 : 10000;
  const minimumLength = mode === 'original' ? 10 : 200;

  function selectMode(nextMode: CreationMode) {
    setMode(nextMode);
    setSeedError('');
    setRightsError('');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = seed.trim();
    if (value.length < minimumLength) {
      setSeedError(mode === 'original'
        ? '请至少写下 10 个字的故事创意。'
        : '请粘贴至少 200 个字的故事素材，便于提炼完整冲突。');
      setRightsError('');
      inputRef.current?.focus();
      return;
    }
    if (value.length > maximumLength) {
      setSeedError(`当前内容超过 ${maximumLength.toLocaleString()} 字，请删减后继续。`);
      setRightsError('');
      inputRef.current?.focus();
      return;
    }
    if (mode === 'adaptation' && !hasAdaptationRights) {
      setSeedError('');
      setRightsError('请先确认你拥有该素材的使用权，或该素材允许改编。');
      rightsRef.current?.focus();
      return;
    }
    setSeedError('');
    setRightsError('');
    onStart(value, mode);
  }

  function focusComposer() {
    const reduceMotion = prefersReducedMotion();
    document.querySelector('#composer')?.scrollIntoView({
      behavior: reduceMotion ? 'auto' : 'smooth',
      block: 'center',
    });
    inputRef.current?.focus({ preventScroll: true });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="landing-nav">
        <button className="landing-brand" type="button" onClick={scrollToTop} aria-label="返回首页顶部">
          <span className="landing-brand-mark"><Clapperboard size={19} strokeWidth={1.6} /></span>
          <span><strong>IDEA / SCRIPT</strong><small>AI 编剧室</small></span>
        </button>
        <nav aria-label="首页导航">
          <a href="#process">创作流程</a>
          <button type="button" onClick={onOpenTrends}>热点选题</button>
          <button type="button" onClick={onOpenSample}>完整示例</button>
        </nav>
        <button className="nav-start" type="button" onClick={focusComposer}>
          开始创作 <ArrowRight size={14} aria-hidden="true" />
        </button>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="hero-title">
          <div className="hero-folio" aria-hidden="true">
            <span>PUBLIC PREVIEW</span>
            <strong>01</strong>
            <i />
            <small>人和 AI<br />逐层共写</small>
          </div>

          <div className="hero-content">
            <div className="hero-kicker"><span /> 开放预览 · 无需登录</div>
            <h1 id="hero-title">一句创意，<br /><em>写成一部短剧。</em></h1>
            <p className="hero-lede">先确认故事、人物和分场，再得到一份可以继续修改的中文短剧初稿。每一步都由你决定是否继续。</p>

            <form className="idea-composer" id="composer" onSubmit={submit} noValidate>
              <fieldset className="composer-modes">
                <legend className="sr-only">选择创作模式</legend>
                <label className={mode === 'original' ? 'active' : ''}>
                  <input
                    type="radio"
                    name="creation-mode"
                    value="original"
                    checked={mode === 'original'}
                    onChange={() => selectMode('original')}
                  />
                  <span>原创短剧</span>
                </label>
                <label className={mode === 'adaptation' ? 'active' : ''}>
                  <input
                    type="radio"
                    name="creation-mode"
                    value="adaptation"
                    checked={mode === 'adaptation'}
                    onChange={() => selectMode('adaptation')}
                  />
                  <span>网文改编</span>
                </label>
              </fieldset>

              <div className="composer-field">
                <PenLine size={19} strokeWidth={1.5} aria-hidden="true" />
                <div className="composer-input-stack">
                  <label htmlFor="story-seed">{mode === 'original' ? '一句话故事创意' : '网文改编素材'}</label>
                  <textarea
                    id="story-seed"
                    ref={inputRef}
                    value={seed}
                    rows={mode === 'original' ? 2 : 5}
                    maxLength={maximumLength}
                    placeholder={prompt}
                    aria-invalid={Boolean(seedError)}
                    aria-describedby={`composer-help${seedError ? ' composer-seed-error' : ''}`}
                    onChange={(event) => {
                      setSeed(event.target.value);
                      if (seedError) setSeedError('');
                    }}
                  />
                </div>
                <button type="submit" aria-label="继续设置创作项目"><ArrowRight size={21} /></button>
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
                <span>至少 {minimumLength} 字 · {seed.length.toLocaleString()} / {maximumLength.toLocaleString()}</span>
                <span>每台设备每天可创建 1 个项目</span>
              </div>
            </form>

            <div className="hero-secondary-links">
              <button className="sample-jump" type="button" onClick={onOpenSample}>
                先查看一份完成的剧本 <ArrowDown size={14} aria-hidden="true" />
              </button>
              <button className="trend-jump" type="button" onClick={onOpenTrends}>
                <Radar size={14} aria-hidden="true" /> 从公开热点寻找灵感
              </button>
            </div>
          </div>

          <aside className="hero-docket" aria-label="分阶段创作示意">
            <div className="docket-heading">
              <span>PROJECT 001</span>
              <strong>零点十七分</strong>
              <small>8 分钟 · 悬疑</small>
            </div>
            <ol>
              <li data-state="complete"><span><Check size={13} />故事内核</span><small>已确认</small></li>
              <li data-state="active"><span><GitBranch size={13} />人物关系</span><small>审阅中</small></li>
              <li><span>情节节拍</span><small>待生成</small></li>
              <li><span>完整剧本</span><small>待生成</small></li>
            </ol>
            <div className="docket-safety">
              <span><RefreshCw size={13} /> 刷新可恢复</span>
              <span><ShieldCheck size={13} /> 失败不覆盖旧稿</span>
            </div>
          </aside>
        </section>

        <ul className="trust-strip" aria-label="产品特点">
          <li><Check size={14} />无需登录即可试写</li>
          <li><Check size={14} />六阶段逐步审阅</li>
          <li><Check size={14} />匿名项目保留 7 天</li>
          <li><Check size={14} />复制全文或下载 Fountain</li>
        </ul>

        <section className="sample-section" id="sample" aria-labelledby="sample-title">
          <ScrollReveal className="landing-section-heading">
            <div>
              <p className="section-label">完整示例</p>
              <h2 id="sample-title">先看一份真正完成的初稿。</h2>
            </div>
            <p>《零点十七分》由一句创意逐层发展而来。故事内核、人物、节拍、分场和对白，都可以在工作台中完整查看。</p>
          </ScrollReveal>

          <ScrollReveal delay={60}>
            <article className="sample-object" aria-label="《零点十七分》完整示例预览">
              <ol className="sample-stage-index">
                {stages.map((stage, index) => (
                  <li key={stage.name}>
                    <i><Check size={10} /></i>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    <span>{stage.name}</span>
                  </li>
                ))}
              </ol>

              <div className="sample-paper">
                <div className="sample-paper-meta"><span>SHORT FILM / 08′</span><span>完整示例</span></div>
                <h3>零点<br />十七分</h3>
                <p>一名失眠的地铁维修工，在末班车后收到一段来自七年前事故现场的求救广播。</p>
                <div className="script-fragment">
                  <strong>内景．夜间控制室—深夜</strong>
                  <p>所有监视器同时跳过一帧。顾言停下笔，把声音推子拉到底。</p>
                  <b>顾言</b>
                  <p>噪声不会准时回来。</p>
                </div>
                <span className="paper-page">01 / 06</span>
              </div>

              <div className="sample-open">
                <p>从故事内核一直看到完整剧本，也可以查看每个阶段的结构。</p>
                <button type="button" onClick={onOpenSample}>
                  打开完整示例 <ArrowRight size={18} />
                </button>
              </div>
            </article>
          </ScrollReveal>
        </section>

        <section className="journey-section" aria-labelledby="journey-title">
          <ScrollReveal className="landing-section-heading journey-heading">
            <div>
              <p className="section-label">创作不是一次提交</p>
              <h2 id="journey-title">你可以在<span className="landing-no-break">故事长成</span>的每一步介入。</h2>
            </div>
            <p>局部修改不会被下一次生成轻易覆盖。人物关系、创作判断和来源边界，都保留成看得见的工作过程。</p>
          </ScrollReveal>

          <div className="journey-track">
            <ScrollReveal className="journey-reveal">
              <article className="journey-node">
                <div className="journey-copy">
                  <span className="journey-tag">审阅</span>
                  <h3>先改对这一层，再进入下一层。</h3>
                  <p>故事内核、人物、空间、节拍和分场都有独立编辑器。可以保存人工修改、只重写不满意的一项，再确认继续。</p>
                  <ul>
                    <li>历史阶段确认后保持锁定</li>
                    <li>生成失败时保留当前稿件</li>
                    <li>刷新页面可以恢复生成进度</li>
                  </ul>
                </div>
                <span className="journey-pin" aria-hidden="true"><PenLine size={17} /></span>
                <div className="journey-visual review-demo" aria-hidden="true">
                  <div className="demo-toolbar"><span>人物 / 顾言</span><small>修改已保存</small></div>
                  <div className="review-demo-body">
                    <span>人物目标</span>
                    <p>找出广播中的求救者，同时隐瞒自己曾参与七年前的事故善后。</p>
                    <span>内在阻力</span>
                    <p><mark>他习惯把愧疚解释成职业谨慎，直到广播准确说出他的名字。</mark></p>
                  </div>
                  <div className="demo-actions" aria-hidden="true">
                    <span><Save size={13} />保存修改</span>
                    <span><RefreshCw size={13} />局部重写</span>
                    <span className="demo-primary"><Check size={13} />确认继续</span>
                  </div>
                </div>
              </article>
            </ScrollReveal>

            <ScrollReveal className="journey-reveal">
              <article className="journey-node journey-node--reverse">
                <div className="journey-copy">
                  <span className="journey-tag">关系</span>
                  <h3>人物不是名单，而是一张冲突网络。</h3>
                  <p>在人物阶段查看同盟、对立、隐瞒与情感牵引。先看清谁推动谁、谁阻碍谁，再决定下一幕应该发生什么。</p>
                  <p className="journey-note"><GitBranch size={15} /> 支持关系方向、强度和人物索引</p>
                </div>
                <span className="journey-pin" aria-hidden="true"><GitBranch size={17} /></span>
                <figure className="journey-visual graph-demo">
                  <svg viewBox="0 0 560 350" role="img" aria-labelledby="graph-demo-title">
                    <title id="graph-demo-title">顾言、林夏、周启明和七号之间的人物关系示意</title>
                    <path className="graph-edge graph-edge--strong" d="M150 170 C225 115 295 108 365 145" />
                    <path className="graph-edge" d="M150 170 C220 225 290 250 375 255" />
                    <path className="graph-edge graph-edge--signal" d="M365 145 C430 170 440 215 375 255" />
                    <path className="graph-edge" d="M150 170 C108 118 105 87 142 59" />
                    <g className="graph-node graph-node--lead" transform="translate(92 141)">
                      <rect width="116" height="58" rx="8" />
                      <text x="58" y="25" textAnchor="middle">顾言</text>
                      <text className="graph-role" x="58" y="43" textAnchor="middle">维修工</text>
                    </g>
                    <g className="graph-node" transform="translate(315 116)">
                      <rect width="104" height="58" rx="8" />
                      <text x="52" y="25" textAnchor="middle">林夏</text>
                      <text className="graph-role" x="52" y="43" textAnchor="middle">记者</text>
                    </g>
                    <g className="graph-node" transform="translate(322 226)">
                      <rect width="108" height="58" rx="8" />
                      <text x="54" y="25" textAnchor="middle">周启明</text>
                      <text className="graph-role" x="54" y="43" textAnchor="middle">旧同事</text>
                    </g>
                    <g className="graph-node graph-node--ghost" transform="translate(93 30)">
                      <rect width="98" height="48" rx="8" />
                      <text x="49" y="30" textAnchor="middle">七号</text>
                    </g>
                    <text className="graph-label" x="246" y="119">互相试探</text>
                    <text className="graph-label" x="231" y="244">共同隐瞒</text>
                    <text className="graph-label graph-label--signal" x="415" y="207">追查</text>
                  </svg>
                  <div className="graph-mobile-list" aria-hidden="true">
                    <div><strong>顾言</strong><span>互相试探</span><strong>林夏</strong></div>
                    <div><strong>顾言</strong><span>共同隐瞒</span><strong>周启明</strong></div>
                    <div><strong>林夏</strong><span>追查</span><strong>周启明</strong></div>
                  </div>
                  <figcaption>人物关系预览，真实工作台支持选择、缩放与重新布局。</figcaption>
                </figure>
              </article>
            </ScrollReveal>

            <ScrollReveal className="journey-reveal">
              <article className="journey-node">
                <div className="journey-copy">
                  <span className="journey-tag">灵感</span>
                  <h3>借用社会张力，不复制现实事件。</h3>
                  <p>热点选题台保留来源状态和风险等级，再把公开讨论抽象成原创人物、矛盾与场景。低风险选题可以直接建立项目。</p>
                  <button className="text-action" type="button" onClick={onOpenTrends}>
                    打开热点选题台 <ArrowRight size={15} />
                  </button>
                </div>
                <span className="journey-pin" aria-hidden="true"><Radar size={17} /></span>
                <div className="journey-visual trend-signal-demo" aria-hidden="true">
                  <div className="signal-demo-heading"><Radar size={17} /><span>公开信号转译</span><small>来源可核对</small></div>
                  <ol>
                    <li><span>公开信号</span><strong>深夜通勤与延误讨论升温</strong></li>
                    <li><span>提取张力</span><strong>等待、失联、责任转移</strong></li>
                    <li><span>虚构种子</span><strong>一座只在末班车后出现的地下站</strong></li>
                  </ol>
                  <p><ShieldCheck size={15} />现实人物、机构、地点和原话不会进入生成上下文。</p>
                </div>
              </article>
            </ScrollReveal>
          </div>
        </section>

        <section className="process-section" id="process" aria-labelledby="process-title">
          <ScrollReveal className="process-intro">
            <p className="section-label">六阶段创作流程</p>
            <h2 id="process-title">AI 负责展开，<br />你负责做决定。</h2>
            <p>每一层都有清楚的产物和下一步动作。发现人物动机不对，可以在进入分场前修正，不必推翻整篇剧本。</p>
            <ul className="process-actions" aria-label="每阶段支持的操作">
              <li><Save size={13} />保存</li>
              <li><RefreshCw size={13} />重写</li>
              <li><Check size={13} />确认</li>
            </ul>
          </ScrollReveal>
          <ol className="process-list">
            {stages.map((stage, index) => (
              <li key={stage.name}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{stage.name}</strong><p>{stage.description}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="closing-section">
          <div className="closing-note"><FileText size={28} strokeWidth={1.3} /><span>未装订的剧本</span></div>
          <div>
            <p className="section-label">你的第一份初稿</p>
            <h2>把脑海里那句话，留成一份可以<span className="landing-no-break">继续写</span>的剧本。</h2>
          </div>
          <button type="button" onClick={focusComposer}>开始创作 <ArrowRight size={17} /></button>
        </section>
      </main>

      <footer className="landing-footer">
        <div><strong>IDEA / SCRIPT</strong><span>给短剧创作者的 AI 共写工作台</span></div>
        <p>匿名项目保留 7 天 · AI 输出请在发布或拍摄前人工审阅</p>
        <div className="footer-safety"><ShieldCheck size={15} /><span>请勿提交个人敏感信息或未获授权的完整作品</span></div>
      </footer>
    </div>
  );
}
