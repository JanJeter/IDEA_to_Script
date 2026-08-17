import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  ExternalLink,
  Flame,
  LoaderCircle,
  Radar,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { TrendBriefResponse, TrendFeed, TrendRiskLevel, TrendTopic } from '../types';

type Props = {
  onHome: () => void;
  onUseTrend: (selection: TrendBriefResponse) => void;
};

const allCategory = '全部信号';

function formatNumber(value: number | null) {
  if (value === null) return '—';
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function riskCopy(level: TrendRiskLevel) {
  if (level === 'BLOCKED') return { label: '暂停创作', className: 'blocked' };
  if (level === 'REVIEW') return { label: '谨慎转译', className: 'review' };
  return { label: '可转译', className: 'low' };
}

function Momentum({ score }: { score: number }) {
  if (score > 0) return <span className="trend-momentum up"><ArrowUp size={12} /> {score}</span>;
  if (score < 0) return <span className="trend-momentum down"><ArrowDown size={12} /> {Math.abs(score)}</span>;
  return <span className="trend-momentum flat">—</span>;
}

function TopicRow({ topic, index, busy, active, onSelect }: {
  topic: TrendTopic;
  index: number;
  busy: boolean;
  active: boolean;
  onSelect: (topic: TrendTopic) => void;
}) {
  const risk = riskCopy(topic.riskLevel);
  return (
    <article className="trend-row">
      <div className="trend-rank">
        <span>{String(topic.rank ?? index + 1).padStart(2, '0')}</span>
        <Momentum score={topic.momentumScore} />
      </div>
      <div className="trend-row-copy">
        <div className="trend-row-meta">
          <span>{topic.sourceLabel}</span>
          <i />
          <span>{topic.category}</span>
          <span className={`trend-risk ${risk.className}`} title={topic.riskReasons.join('；')}><ShieldCheck size={12} />{risk.label}</span>
        </div>
        <h2>{topic.title}</h2>
        {topic.excerpt && <p>{topic.excerpt}</p>}
        <div className="trend-row-foot">
          <a href={topic.sourceUrl} target="_blank" rel="noreferrer">
            核对原始信号 <ExternalLink size={12} />
          </a>
          <span><Clock3 size={12} /> {formatDate(topic.lastSeenAt)}</span>
        </div>
      </div>
      <div className="trend-heat" aria-label={`创作机会分 ${topic.heatScore}`}>
        <strong>{topic.heatScore}</strong>
        <span>机会分</span>
        <i><b style={{ width: `${Math.max(4, Math.min(100, topic.heatScore))}%` }} /></i>
        <small>{formatNumber(topic.views)} 关注</small>
      </div>
      <button
        className="trend-translate"
        type="button"
        disabled={busy || topic.riskLevel === 'BLOCKED'}
        onClick={() => onSelect(topic)}
      >
        {active ? <LoaderCircle className="spin-icon" size={16} /> : <Sparkles size={16} />}
        <span>{topic.riskLevel === 'BLOCKED' ? '不自动转译' : topic.riskLevel === 'REVIEW' ? '查看审核项' : '转成短剧'}</span>
        {topic.riskLevel !== 'BLOCKED' && <ChevronRight size={15} />}
      </button>
    </article>
  );
}

function BriefSheet({ selection, onClose, onUse }: {
  selection: TrendBriefResponse;
  onClose: () => void;
  onUse: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const risk = riskCopy(selection.topic.riskLevel);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(selection.brief.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="trend-brief-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="trend-brief-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trend-brief-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="trend-brief-header">
          <div>
            <span>TRANSFORMATION NOTE / AISCRIPT</span>
            <h2 id="trend-brief-title">把注意力，改写成人物的选择。</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭热点转译" autoFocus><X size={19} /></button>
        </header>

        <div className="trend-brief-body">
          <aside className="trend-source-note">
            <span>原始信号</span>
            <h3>{selection.topic.title}</h3>
            <p>{selection.topic.excerpt || '该信号仅提供标题与公开热度指标。'}</p>
            <a href={selection.topic.sourceUrl} target="_blank" rel="noreferrer">
              {selection.topic.sourceLabel} · 核对来源 <ExternalLink size={13} />
            </a>
            <div className={`trend-risk ${risk.className}`}><ShieldCheck size={13} />{risk.label}</div>
            {selection.topic.riskReasons.length > 0 && (
              <ul className="trend-review-reasons">
                {selection.topic.riskReasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
          </aside>

          <div className="trend-brief-main">
            <section className="brief-project-seed">
              <span>建议短剧种子</span>
              <h3>《{selection.projectInput.title}》</h3>
              <p>{selection.projectInput.logline}</p>
              <dl>
                <div><dt>类型</dt><dd>{selection.projectInput.genre}</dd></div>
                <div><dt>时长</dt><dd>{selection.projectInput.targetMinutes} 分钟</dd></div>
                <div><dt>语调</dt><dd>{selection.projectInput.tone}</dd></div>
              </dl>
            </section>

            <section className="brief-kernel">
              <div><span>创作内核</span><p>{selection.brief.creativeKernel}</p></div>
              <div><span>观众问题</span><p>{selection.brief.audienceQuestion}</p></div>
            </section>

            <section className="brief-prompt">
              <div className="brief-section-title">
                <span>AIScript 提示词</span>
                <button type="button" onClick={() => void copyPrompt()}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}
                </button>
              </div>
              <pre>{selection.brief.prompt}</pre>
            </section>

            <section className="brief-safety">
              <span><ShieldCheck size={15} /> 虚构安全边界</span>
              <ul>{selection.brief.safetyRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
            </section>
          </div>
        </div>

        <footer className="trend-brief-actions">
          <p>{selection.topic.riskLevel === 'REVIEW'
            ? '该信号需要正式人工审核记录；当前只可核对和复制提示词，不能进入生成队列。'
            : '建立项目后仍按六个阶段审阅；不会直接发布，也不会把热点摘要当成已核验事实。'}</p>
          <button type="button" onClick={onUse} disabled={selection.topic.riskLevel === 'REVIEW'}>
            {selection.topic.riskLevel === 'REVIEW' ? '等待人工审核' : '建立短剧项目'} <ArrowRight size={17} />
          </button>
        </footer>
      </section>
    </div>
  );
}

export function TrendRadar({ onHome, onUseTrend }: Props) {
  const [feed, setFeed] = useState<TrendFeed>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [briefingId, setBriefingId] = useState('');
  const [selection, setSelection] = useState<TrendBriefResponse>();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(allCategory);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.listTrends()
      .then((result) => { if (!cancelled) setFeed(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : '热点信号暂时不可用'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const categories = useMemo(() => [
    allCategory,
    ...Array.from(new Set((feed?.items ?? []).map((item) => item.category))).sort(),
  ], [feed]);

  const visibleTopics = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    return (feed?.items ?? []).filter((topic) => {
      const categoryMatches = category === allCategory || topic.category === category;
      const keywordMatches = !keyword || `${topic.title} ${topic.excerpt}`.toLocaleLowerCase('zh-CN').includes(keyword);
      return categoryMatches && keywordMatches;
    });
  }, [category, feed, query]);

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      setFeed(await api.refreshTrends());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新失败，请稍后重试');
    } finally {
      setRefreshing(false);
    }
  }

  async function openBrief(topic: TrendTopic) {
    if (topic.riskLevel === 'BLOCKED' || briefingId) return;
    setBriefingId(topic.id);
    setError('');
    try {
      setSelection(await api.getTrendBrief(topic.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '暂时无法转译这个热点');
    } finally {
      setBriefingId('');
    }
  }

  return (
    <div className="trend-page">
      <header className="trend-nav">
        <button className="landing-brand" type="button" onClick={onHome}>
          <span className="landing-brand-mark"><Radar size={18} strokeWidth={1.6} /></span>
          <span><strong>IDEA / SIGNAL</strong><small>热点选题台</small></span>
        </button>
        <div className="trend-nav-status">
          <i className={feed?.stale ? 'stale' : 'online'} />
          <span>{feed?.stale ? '等待新鲜信号' : '公开信号已同步'}</span>
        </div>
        <button className="trend-back" type="button" onClick={onHome}>返回编剧室 <ArrowRight size={14} /></button>
      </header>

      <main className="trend-radar">
        <section className="trend-masthead">
          <div className="trend-folio" aria-hidden="true"><span>02</span><i /><small>SIGNAL<br />TO STORY</small></div>
          <div className="trend-title-copy">
            <div className="hero-kicker"><span /> PUBLIC ATTENTION DESK · 公开注意力样本</div>
            <h1>热点不是故事，<br /><em>冲突才是。</em></h1>
            <p>持续收集公开关注信号，保留来源与时间，再把现实人物和事件抽离，只留下值得被讨论的社会张力。</p>
          </div>
          <aside className="trend-method-note">
            <span>方法 / 不是事实核验</span>
            <p>排名代表公开关注度，不代表真实性或价值判断。进入 AIScript 前会先去实名、换时空、改因果。</p>
          </aside>
        </section>

        <section className="trend-status-strip" aria-label="监听状态">
          <div><Radar size={17} /><span>最近同步</span><strong>{formatDate(feed?.refreshedAt ?? null)}</strong></div>
          <div><BookOpen size={17} /><span>当前信号</span><strong>{feed?.items.length ?? 0}</strong></div>
          <div><Flame size={17} /><span>可创作</span><strong>{feed?.items.filter((item) => item.riskLevel === 'LOW').length ?? 0}</strong></div>
          <button type="button" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'spin-icon' : ''} size={15} />{refreshing ? '同步中' : '同步公开信号'}
          </button>
        </section>

        {error && <div className="trend-error" role="alert"><CircleAlert size={16} /><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>}

        <section className="trend-desk">
          <aside className="trend-filters">
            <div className="trend-filter-heading"><span>选题索引</span><strong>{String(visibleTopics.length).padStart(2, '0')}</strong></div>
            <label className="trend-search">
              <span className="sr-only">搜索热点</span>
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公开信号" />
            </label>
            <div className="trend-category-list" aria-label="热点分类">
              {categories.map((item) => (
                <button key={item} type="button" aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>
                  <span>{item}</span>
                  <small>{item === allCategory ? feed?.items.length ?? 0 : feed?.items.filter((topic) => topic.category === item).length ?? 0}</small>
                </button>
              ))}
            </div>
            <div className="trend-source-legend">
              <span>监听来源</span>
              {(feed?.sources ?? []).map((source) => (
                <div key={source.id} title={`${source.message ?? ''}${source.lastSuccessAt ? ` · 最近成功 ${formatDate(source.lastSuccessAt)}` : ''}`}>
                  <i className={source.degraded ? 'degraded' : source.status} />
                  <p><strong>{source.label}</strong><small>{source.degraded ? '部分来源降级' : source.stale ? '快照过期' : source.status === 'ok' ? '连接正常' : '本轮不可用'}</small></p>
                </div>
              ))}
              {!feed?.sources.length && <p className="source-waiting">等待来源回报…</p>}
            </div>
          </aside>

          <div className="trend-ledger">
            <header className="trend-ledger-head">
              <div><span>RANK</span><span>公开信号 / 主题</span></div>
              <p>按创作机会排序 · 每条信号均可回到原始来源核对</p>
            </header>
            {loading ? (
              <div className="trend-loading"><LoaderCircle className="spin-icon" size={23} /><p>正在整理公开注意力样本…</p></div>
            ) : visibleTopics.length ? (
              visibleTopics.map((topic, index) => (
                <TopicRow
                  key={topic.id}
                  topic={topic}
                  index={index}
                  busy={Boolean(briefingId)}
                  active={briefingId === topic.id}
                  onSelect={(item) => void openBrief(item)}
                />
              ))
            ) : (
              <div className="trend-empty"><Radar size={30} strokeWidth={1.3} /><h2>这一栏暂时没有信号。</h2><p>换一个分类、清除搜索词，或稍后重新同步。</p></div>
            )}
          </div>
        </section>

        <section className="trend-ethics-note">
          <span><ShieldCheck size={18} /> 创作边界</span>
          <p>不复制新闻正文，不把未经证实的说法写成事实，不为现实人物虚构动机与对白。系统只提取社会张力，并至少改变人物、地点、时间、因果链、视角和结局中的四项。</p>
        </section>
      </main>

      <footer className="trend-footer">
        <strong>IDEA / SIGNAL</strong>
        <p>公开关注只是选题入口，最终剧本仍由你逐阶段确认。</p>
        <button type="button" onClick={onHome}>回到一句创意 <ArrowRight size={14} /></button>
      </footer>

      {selection && (
        <BriefSheet
          selection={selection}
          onClose={() => setSelection(undefined)}
          onUse={() => { onUseTrend(selection); setSelection(undefined); }}
        />
      )}
    </div>
  );
}
