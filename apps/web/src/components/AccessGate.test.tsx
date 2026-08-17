import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessGate } from './AccessGate';

afterEach(cleanup);

describe('AccessGate', () => {
  it('validates an empty access code locally', () => {
    const onAuthorize = vi.fn();
    render(<AccessGate onAuthorize={onAuthorize} onOpenSample={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '进入编剧室' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入管理员发给你的访问码');
    expect(onAuthorize).not.toHaveBeenCalled();
  });

  it('submits a trimmed code and exposes server errors', async () => {
    const onAuthorize = vi.fn().mockRejectedValue(new Error('访问码无效'));
    render(<AccessGate onAuthorize={onAuthorize} onOpenSample={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('访问码'), { target: { value: '  seat-001-secret  ' } });
    fireEvent.click(screen.getByRole('button', { name: '进入编剧室' }));
    await waitFor(() => expect(onAuthorize).toHaveBeenCalledWith('seat-001-secret'));
    expect(await screen.findByRole('alert')).toHaveTextContent('访问码无效');
  });

  it('opens the API-free complete sample', () => {
    const onOpenSample = vi.fn();
    render(<AccessGate onAuthorize={vi.fn()} onOpenSample={onOpenSample} />);
    fireEvent.click(screen.getByRole('button', { name: /先查看完整示例/ }));
    expect(onOpenSample).toHaveBeenCalledOnce();
  });
});
