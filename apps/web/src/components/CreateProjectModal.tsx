import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { CreateProjectInput } from '../types';

type Props = {
  open: boolean;
  busy: boolean;
  seed?: string;
  mode?: 'original' | 'adaptation' | 'trend';
  initial?: CreateProjectInput;
  onClose: () => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
};

const initialValue: CreateProjectInput = {
  mode: 'ORIGINAL',
  title: '零点十七分',
  logline: '一名失眠的地铁维修工，在末班车后收到一段来自七年前事故现场的求救广播。',
  genre: '悬疑科幻',
  tone: '克制、潮湿，结尾带有希望',
  targetMinutes: 8,
  language: 'zh-CN',
};

export function CreateProjectModal({ open, busy, seed, mode = 'original', initial, onClose, onCreate }: Props) {
  const [form, setForm] = useState<CreateProjectInput>(initialValue);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm(initial);
      setError('');
      return;
    }
    setForm({
      ...initialValue,
      mode: mode === 'adaptation' ? 'ADAPTATION' : 'ORIGINAL',
      logline: seed ? seed.slice(0, 1000) : initialValue.logline,
      sourceText: mode === 'adaptation' ? seed || initialValue.logline : undefined,
    });
  }, [initial, mode, open, seed]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
      previouslyFocused?.focus();
    };
  }, [busy, onClose, open]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await onCreate(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败');
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="seed-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <div className="modal-kicker">{mode === 'adaptation' ? 'ADAPTATION' : mode === 'trend' ? 'SIGNAL TO STORY' : 'NEW STORY'} / 001</div>
        <h2 id="new-project-title">{mode === 'adaptation' ? '把素材收束成短剧。' : mode === 'trend' ? '让热点退后，让人物上场。' : '把火花留在纸上。'}</h2>
        <p className="modal-intro">{mode === 'trend' ? '核对自动转译的创作种子。建立档案后，仍由你逐阶段确认故事。' : '补充几个创作约束。故事会先建立档案，再进入逐层生成。'}</p>

        <form onSubmit={submit} className="seed-form">
          <label>
            <span>项目名称</span>
            <input
              ref={titleRef}
              value={form.title}
              maxLength={80}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
            />
          </label>
          <label className="wide-field">
            <span>{mode === 'adaptation' ? '故事素材' : mode === 'trend' ? '虚构创作种子' : '一句话创意'}</span>
            <textarea
              value={mode === 'adaptation' ? form.sourceText ?? '' : form.logline}
              minLength={10}
              maxLength={mode === 'adaptation' ? 10000 : 1000}
              rows={4}
              onChange={(event) => setForm(mode === 'adaptation'
                ? { ...form, mode: 'ADAPTATION', sourceText: event.target.value, logline: event.target.value.slice(0, 1000) }
                : mode === 'trend'
                  ? { ...form, mode: 'TREND_INSPIRED', logline: event.target.value }
                  : { ...form, mode: 'ORIGINAL', logline: event.target.value, sourceText: undefined })}
              required
            />
            <small>{(mode === 'adaptation' ? form.sourceText?.length ?? 0 : form.logline.length).toLocaleString()} / {mode === 'adaptation' ? '10,000' : '1,000'}</small>
          </label>
          {mode === 'trend' && (
            <div className="trend-modal-note">
              <span>已附带来源与安全边界</span>
              <p>系统会把现实姓名、机构、地点与原话排除在剧本之外，并要求至少四项结构性改写。</p>
            </div>
          )}
          <div className="form-row">
            <label>
              <span>类型</span>
              <input
                value={form.genre}
                maxLength={40}
                onChange={(event) => setForm({ ...form, genre: event.target.value })}
                required
              />
            </label>
            <label>
              <span>目标时长</span>
              <select
                value={form.targetMinutes}
                onChange={(event) => setForm({ ...form, targetMinutes: Number(event.target.value) })}
              >
                <option value={3}>3 分钟</option>
                <option value={5}>5 分钟</option>
                <option value={8}>8 分钟</option>
                <option value={12}>12 分钟</option>
                <option value={20}>20 分钟</option>
              </select>
            </label>
          </div>
          <label className="wide-field">
            <span>气质与语调</span>
            <input
              value={form.tone}
              maxLength={80}
              onChange={(event) => setForm({ ...form, tone: event.target.value })}
              required
            />
          </label>

          {error && <div className="form-error">{error}</div>}
          <button className="primary-button seed-submit" type="submit" disabled={busy}>
            <span>{busy ? '正在建档…' : mode === 'trend' ? '建立热点短剧档案' : '创建故事档案'}</span>
            <ArrowRight size={18} />
          </button>
        </form>
      </section>
    </div>
  );
}
