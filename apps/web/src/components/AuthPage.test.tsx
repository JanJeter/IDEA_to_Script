import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthPage, type AuthMode } from './AuthPage';

afterEach(cleanup);

function renderAuth(mode: AuthMode = 'login', overrides: Partial<Parameters<typeof AuthPage>[0]> = {}) {
  const onModeChange = vi.fn();
  const onLogin = vi.fn(async () => undefined);
  const onRegister = vi.fn(async () => undefined);
  const onOpenHome = vi.fn();
  const onOpenSample = vi.fn();
  render(
    <AuthPage
      mode={mode}
      onModeChange={onModeChange}
      onLogin={onLogin}
      onRegister={onRegister}
      onOpenHome={onOpenHome}
      onOpenSample={onOpenSample}
      {...overrides}
    />,
  );
  return { onModeChange, onLogin, onRegister, onOpenHome, onOpenSample };
}

describe('AuthPage', () => {
  it('validates login fields and submits an unmodified password', async () => {
    const { onLogin } = renderAuth();
    fireEvent.click(screen.getByRole('button', { name: '进入编剧室' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入用户名');
    expect(screen.getByLabelText('用户名')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: '  writer.lin  ' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: ' password-with-spaces ' } });
    fireEvent.submit(screen.getByRole('button', { name: '进入编剧室' }).closest('form')!);

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('writer.lin', ' password-with-spaces '));
  });

  it('enforces the registration contract before submitting', async () => {
    const { onRegister } = renderAuth('register');
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: '编剧小林' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'story-room-2026' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'different-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始创作' }));

    expect(screen.getByRole('alert')).toHaveTextContent('两次输入的密码不一致');
    expect(screen.getByLabelText('再次输入密码')).toHaveFocus();
    expect(onRegister).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'story-room-2026' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始创作' }));
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith('编剧小林', 'story-room-2026', 'story-room-2026'));
  });

  it('rejects unsupported username punctuation locally', () => {
    const { onRegister } = renderAuth('register');
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'writer@email' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'story-room-2026' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'story-room-2026' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始创作' }));

    expect(screen.getByRole('alert')).toHaveTextContent('用户名只能包含');
    expect(onRegister).not.toHaveBeenCalled();
  });

  it('normalizes compatible-width username characters before registration', async () => {
    const { onRegister } = renderAuth('register');
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: ' Ｗriter_０１ ' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'story-room-2026' } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: 'story-room-2026' } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始创作' }));

    await waitFor(() => expect(onRegister).toHaveBeenCalledWith('Writer_01', 'story-room-2026', 'story-room-2026'));
  });

  it('counts Unicode password characters the same way as the API validator', async () => {
    const { onRegister } = renderAuth('register');
    const password = '剧本🎬'.repeat(5);
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'unicode.writer' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('再次输入密码'), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: '注册并开始创作' }));

    await waitFor(() => expect(onRegister).toHaveBeenCalledWith('unicode.writer', password, password));
  });

  it('reveals the password and moves focus when switching tabs with arrow keys', async () => {
    function AuthHarness() {
      const [mode, setMode] = useState<AuthMode>('login');
      return (
        <AuthPage
          mode={mode}
          onModeChange={setMode}
          onLogin={vi.fn()}
          onRegister={vi.fn()}
          onOpenHome={vi.fn()}
          onOpenSample={vi.fn()}
        />
      );
    }
    render(<AuthHarness />);
    const password = screen.getByLabelText('密码');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password).toHaveAttribute('type', 'text');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    const registerTab = screen.getByRole('tab', { name: '注册' });
    expect(registerTab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(registerTab).toHaveFocus());
  });

  it('surfaces server errors, prevents repeat submission, and keeps public exits available', async () => {
    let rejectLogin: ((reason: Error) => void) | undefined;
    const onLogin = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectLogin = reject; }));
    const { onOpenHome, onOpenSample } = renderAuth('login', {
      continuation: '登录后将继续创建《零点十七分》',
      onLogin,
    });
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'writer' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'story-room' } });
    fireEvent.click(screen.getByRole('button', { name: '进入编剧室' }));

    expect(screen.getByRole('button', { name: '正在登录' })).toBeDisabled();
    expect(onLogin).toHaveBeenCalledOnce();
    rejectLogin?.(new Error('账号或密码错误'));
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码错误');

    fireEvent.click(screen.getByRole('button', { name: '公开首页' }));
    fireEvent.click(screen.getByRole('button', { name: /先看完整示例/ }));
    expect(onOpenHome).toHaveBeenCalledOnce();
    expect(onOpenSample).toHaveBeenCalledOnce();
  });

  it('shows a non-interactive session check state', () => {
    renderAuth('login', { checking: true });
    expect(screen.getByRole('status')).toHaveTextContent('正在查看你是否已登录');
    expect(screen.queryByRole('button', { name: '进入编剧室' })).not.toBeInTheDocument();
  });
});
