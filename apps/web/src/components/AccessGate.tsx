import { useRef, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Film, KeyRound, LoaderCircle } from 'lucide-react';
import './AccessGate.css';

type AccessGateProps = {
  checking?: boolean;
  onAuthorize: (code: string) => Promise<void>;
  onOpenSample: () => void;
};

export function AccessGate({ checking = false, onAuthorize, onOpenSample }: AccessGateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) {
      setError('请输入管理员发给你的访问码');
      inputRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onAuthorize(code.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '访问码验证失败，请稍后再试');
      inputRef.current?.select();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="access-gate">
      <div className="access-folio" aria-hidden="true">
        <span>PRIVATE SCREENING</span>
        <i />
        <strong>100</strong>
        <small>席位内测</small>
      </div>

      <section className="access-stage" aria-labelledby="access-title">
        <div className="access-brand"><span>I / S</span> IDEA TO SCREENPLAY</div>
        <div className="access-copy">
          <p className="access-kicker"><KeyRound size={16} /> 限量创作通行证</p>
          <h1 id="access-title">这里是编剧室，<br /><em>不是候场大厅。</em></h1>
          <p>当前版本只向受邀创作者开放。输入你的独立访问码，项目与生成额度会绑定到同一个席位。</p>
        </div>

        {checking ? (
          <div className="access-checking" role="status">
            <LoaderCircle size={20} /> 正在核验创作席位…
          </div>
        ) : (
          <form className="access-form" onSubmit={(event) => void submit(event)} noValidate>
            <label htmlFor="access-code">访问码</label>
            <div className={`access-input ${error ? 'has-error' : ''}`}>
              <input
                ref={inputRef}
                id="access-code"
                name="access-code"
                type={visible ? 'text' : 'password'}
                value={code}
                autoComplete="one-time-code"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'access-error' : 'access-hint'}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (error) setError('');
                }}
                placeholder="例如 IDS-••••-••••"
              />
              <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={visible ? '隐藏访问码' : '显示访问码'}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <p id={error ? 'access-error' : 'access-hint'} className={error ? 'access-error' : 'access-hint'} role={error ? 'alert' : undefined}>
              {error || '访问码保存在安全 Cookie 中；请勿转发给他人。'}
            </p>
            <button className="access-submit" type="submit" disabled={submitting}>
              {submitting ? <><LoaderCircle className="access-spinner" size={18} /> 正在验证</> : <>进入编剧室 <ArrowRight size={18} /></>}
            </button>
          </form>
        )}

        <button className="access-sample" type="button" onClick={onOpenSample}>
          <Film size={17} /> 没有访问码？先查看完整示例
        </button>
      </section>

      <aside className="access-notes" aria-label="内测说明">
        <span>01</span><p>每位创作者使用独立访问码</p>
        <span>02</span><p>生成任务受全站预算保护</p>
        <span>03</span><p>匿名项目将在 7 天后清理</p>
      </aside>
    </main>
  );
}
