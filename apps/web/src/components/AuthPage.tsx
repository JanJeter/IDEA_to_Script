import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  Eye,
  EyeOff,
  Film,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from 'lucide-react';
import './AuthPage.css';

export type AuthMode = 'login' | 'register';

type AuthPageProps = {
  mode?: AuthMode;
  checking?: boolean;
  continuation?: string;
  onModeChange: (mode: AuthMode) => void;
  onLogin: (identifier: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string, passwordConfirmation: string) => Promise<void>;
  onOpenHome: () => void;
  onOpenSample: () => void;
};

type InvalidField = 'account' | 'password' | 'confirmation' | '';

const usernamePattern = /^[\p{Script=Han}A-Za-z0-9._-]+$/u;

function validatedLength(value: string) {
  const presentationSequences = value.match(/[^\uFE0F\uFE0E][\uFE0F\uFE0E]/g)?.length ?? 0;
  const surrogatePairs = value.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0;
  return value.length - presentationSequences - surrogatePairs;
}

export function AuthPage({
  mode = 'login',
  checking = false,
  continuation,
  onModeChange,
  onLogin,
  onRegister,
  onOpenHome,
  onOpenSample,
}: AuthPageProps) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [invalidField, setInvalidField] = useState<InvalidField>('');
  const [error, setError] = useState('');
  const accountRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);
  const focusTabAfterModeChange = useRef(false);

  useEffect(() => {
    setPassword('');
    setConfirmation('');
    setPasswordVisible(false);
    setInvalidField('');
    setError('');
    if (checking) return;
    const shouldFocusTab = focusTabAfterModeChange.current;
    focusTabAfterModeChange.current = false;
    const timer = window.setTimeout(() => {
      if (shouldFocusTab) (mode === 'login' ? loginTabRef : registerTabRef).current?.focus();
      else accountRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checking, mode]);

  function focusInvalid(field: Exclude<InvalidField, ''>) {
    ({ account: accountRef, password: passwordRef, confirmation: confirmationRef }[field]).current?.focus();
  }

  function fail(field: Exclude<InvalidField, ''>, message: string) {
    setInvalidField(field);
    setError(message);
    focusInvalid(field);
    return false;
  }

  function validate() {
    const normalizedAccount = account.trim().normalize('NFKC');
    if (!normalizedAccount) return fail('account', mode === 'login' ? '请输入用户名。' : '请先设置用户名。');
    if (mode === 'register') {
      const accountLength = validatedLength(normalizedAccount);
      if (accountLength < 3 || accountLength > 32) {
        return fail('account', '用户名需要 3–32 个字符。');
      }
      if (!usernamePattern.test(normalizedAccount)) {
        return fail('account', '用户名只能包含中英文、数字、句点、下划线或连字符。');
      }
    }
    if (!password) return fail('password', '请输入密码。');
    const passwordLength = validatedLength(password);
    if (passwordLength > 128) return fail('password', '密码不能超过 128 个字符。');
    if (mode === 'register' && passwordLength < 15) {
      return fail('password', '密码需要 15–128 个字符。');
    }
    if (mode === 'register' && confirmation !== password) {
      return fail('confirmation', '两次输入的密码不一致。');
    }
    setInvalidField('');
    setError('');
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || checking || !validate()) return;
    setSubmitting(true);
    try {
      const normalizedAccount = account.trim().normalize('NFKC');
      if (mode === 'login') await onLogin(normalizedAccount, password);
      else await onRegister(normalizedAccount, password, confirmation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${mode === 'login' ? '登录' : '注册'}失败，请稍后重试。`);
      setInvalidField('');
      passwordRef.current?.focus();
      passwordRef.current?.select();
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode || submitting || checking) return;
    onModeChange(nextMode);
  }

  function handleTabsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    focusTabAfterModeChange.current = true;
    switchMode(mode === 'login' ? 'register' : 'login');
  }

  const busy = checking || submitting;
  const errorId = error ? 'auth-form-error' : undefined;

  return (
    <main className="auth-page">
      <aside className="auth-folio" aria-hidden="true">
        <Clapperboard size={21} strokeWidth={1.55} />
        <span>WRITERS' ROOM</span>
        <i />
        <strong>01</strong>
      </aside>

      <section className="auth-manifesto" aria-labelledby="auth-page-title">
        <button className="auth-wordmark" type="button" onClick={onOpenHome}>
          <span>IS</span>
          <strong>IDEA TO SCREENPLAY</strong>
        </button>

        <div className="auth-manifesto-copy">
          <p className="auth-eyebrow"><LockKeyhole size={15} /> 私人编剧工作台</p>
          <h1 id="auth-page-title">把故事留在<br /><em>你的名字下。</em></h1>
          <p>登录后，近期创作的项目、分场和修改会归在同一个账号下。</p>
        </div>

        <ol className="auth-production-notes">
          <li><span>01</span><p><strong>一个账号</strong><small>项目归在同一个创作账号下</small></p></li>
          <li><span>02</span><p><strong>分阶段确认</strong><small>人物、节拍、分场都由你定稿</small></p></li>
          <li><span>03</span><p><strong>回到创作现场</strong><small>登录后继续近期的写作</small></p></li>
        </ol>
      </section>

      <section className="auth-sheet" aria-labelledby="auth-form-title">
        <header className="auth-sheet-header">
          <button type="button" onClick={onOpenHome}><ArrowLeft size={16} /> 公开首页</button>
          <span>创作者档案</span>
        </header>

        <div className="auth-sheet-body">
          <div className="auth-stamp" aria-hidden="true"><UserRound size={18} /><span>ACCOUNT<br />RECORD</span></div>

          <div className="auth-tabs" role="tablist" aria-label="选择登录或注册" onKeyDown={handleTabsKeyDown}>
            <button
              ref={loginTabRef}
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              tabIndex={mode === 'login' ? 0 : -1}
              disabled={busy}
              onClick={() => switchMode('login')}
            >登录</button>
            <button
              ref={registerTabRef}
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              tabIndex={mode === 'register' ? 0 : -1}
              disabled={busy}
              onClick={() => switchMode('register')}
            >注册</button>
          </div>

          <div className="auth-form-heading">
            <span>{mode === 'login' ? 'WELCOME BACK' : 'NEW WRITER'}</span>
            <h2 id="auth-form-title">{mode === 'login' ? '回到编剧室' : '建立创作账号'}</h2>
            <p>{mode === 'login' ? '用你的用户名和密码继续写作。' : '首版只需用户名和密码，不收集邮箱。'}</p>
          </div>

          {continuation && (
            <div className="auth-continuation" role="status">
              <Check size={15} />
              <span>{continuation}</span>
            </div>
          )}

          {checking ? (
            <div className="auth-checking" role="status">
              <LoaderCircle size={19} />
              <span>正在查看你是否已登录…</span>
            </div>
          ) : (
            <form className="auth-form" aria-busy={submitting} onSubmit={(event) => void submit(event)} noValidate>
              <label className={invalidField === 'account' ? 'has-error' : ''}>
                <span>用户名</span>
                <input
                  ref={accountRef}
                  name={mode === 'login' ? 'identifier' : 'username'}
                  autoComplete="username"
                  value={account}
                  minLength={mode === 'register' ? 3 : undefined}
                  maxLength={64}
                  disabled={submitting}
                  aria-invalid={invalidField === 'account'}
                  aria-describedby={invalidField === 'account' ? errorId : undefined}
                  placeholder={mode === 'login' ? '输入用户名' : '例如：编剧小林'}
                  onChange={(event) => {
                    setAccount(event.target.value);
                    if (invalidField === 'account' || error) { setInvalidField(''); setError(''); }
                  }}
                />
              </label>

              <label className={invalidField === 'password' ? 'has-error' : ''}>
                <span>密码</span>
                <span className="auth-password-field">
                  <input
                    ref={passwordRef}
                    name="password"
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    value={password}
                    minLength={mode === 'register' ? 15 : undefined}
                    maxLength={256}
                    disabled={submitting}
                    aria-invalid={invalidField === 'password'}
                    aria-describedby={invalidField === 'password' ? errorId : mode === 'register' ? 'auth-password-hint' : undefined}
                    placeholder={mode === 'login' ? '输入密码' : '至少 15 个字符'}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (invalidField === 'password' || error) { setInvalidField(''); setError(''); }
                    }}
                  />
                  <button
                    type="button"
                    disabled={submitting}
                    aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                    onClick={() => setPasswordVisible((current) => !current)}
                  >
                    {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>

              {mode === 'register' && (
                <label className={invalidField === 'confirmation' ? 'has-error' : ''}>
                  <span>再次输入密码</span>
                  <input
                    ref={confirmationRef}
                    name="passwordConfirmation"
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmation}
                    maxLength={256}
                    disabled={submitting}
                    aria-invalid={invalidField === 'confirmation'}
                    aria-describedby={invalidField === 'confirmation' ? errorId : undefined}
                    placeholder="再输入一次"
                    onChange={(event) => {
                      setConfirmation(event.target.value);
                      if (invalidField === 'confirmation' || error) { setInvalidField(''); setError(''); }
                    }}
                  />
                </label>
              )}

              {mode === 'register' && !error && <p className="auth-form-hint" id="auth-password-hint">用户名支持中英文、数字与 . _ -</p>}
              {error && <p className="auth-form-error" id="auth-form-error" role="alert">{error}</p>}

              <button className="auth-submit" type="submit" disabled={submitting}>
                {submitting ? (
                  <><LoaderCircle className="auth-spinner" size={18} /> {mode === 'login' ? '正在登录' : '正在建立档案'}</>
                ) : (
                  <>{mode === 'login' ? '进入编剧室' : '注册并开始创作'} <ArrowRight size={18} /></>
                )}
              </button>
            </form>
          )}

          <button className="auth-sample" type="button" onClick={onOpenSample}>
            <Film size={16} /> 暂不登录，先看完整示例
          </button>
        </div>

        <footer className="auth-sheet-footer">
          <span>NO. {new Date().getFullYear()} / IDS</span>
          <span>密码仅用于保护你的创作档案</span>
        </footer>
      </section>
    </main>
  );
}
