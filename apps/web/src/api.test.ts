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

describe('API client access lifecycle', () => {
  it('preserves HTTP status and announces a protected-route 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { message: '需要有效访问码' })));
    const unauthorized = vi.fn();
    window.addEventListener('ids:unauthorized', unauthorized, { once: true });

    const error = await api.listProjects().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: '需要有效访问码' });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('uses the custom anti-CSRF marker for access authorization', async () => {
    const request = vi.fn().mockResolvedValue(response(201, { required: true, authorized: true }));
    vi.stubGlobal('fetch', request);

    await api.authorizeAccess('seat-code');

    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/access/authorize'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-IDS-Access': 'authorize',
        }),
      }),
    );
  });
});
