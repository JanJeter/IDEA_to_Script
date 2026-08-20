import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api';

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('API client authentication lifecycle', () => {
  it('preserves HTTP status and announces a protected-route 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { message: '请先登录' })));
    const unauthorized = vi.fn();
    window.addEventListener('ids:authentication-required', unauthorized, { once: true });

    const error = await api.listProjects().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: '请先登录' });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('sends the username and password contract when registering', async () => {
    const request = vi.fn().mockResolvedValue(response(201, {
      authenticated: true,
      user: { id: 'user-1', username: '编剧小林' },
    }));
    vi.stubGlobal('fetch', request);

    await api.register('编剧小林', 'story-room-2026', 'story-room-2026');

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/auth/register'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          username: '编剧小林',
          password: 'story-room-2026',
          passwordConfirmation: 'story-room-2026',
        }),
      }),
    );
  });

  it('does not announce expected login failures as an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { message: '账号或密码错误' })));
    const unauthorized = vi.fn();
    window.addEventListener('ids:authentication-required', unauthorized, { once: true });

    await expect(api.login('编剧小林', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      message: '账号或密码错误',
    });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('accepts a no-content logout response', async () => {
    const request = vi.fn().mockResolvedValue(response(204, undefined));
    vi.stubGlobal('fetch', request);

    await expect(api.logout()).resolves.toEqual({ authenticated: false, user: null });
  });
});
