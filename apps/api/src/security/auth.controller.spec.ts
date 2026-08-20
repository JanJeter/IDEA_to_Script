import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { AuthNoStoreInterceptor } from './auth-no-store.interceptor';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  it('sets the account cookie and removes the former visitor cookie after registration', async () => {
    const auth = {
      assertMutationRequest: jest.fn(),
      register: jest.fn().mockResolvedValue({
        token: 'session-token',
        payload: { authenticated: true, user: { id: 'user-1', username: 'writer' } },
      }),
      setSessionCookie: jest.fn(),
      clearLegacyVisitorCookie: jest.fn(),
    };
    const controller = new AuthController(auth as never);
    const request = {
      headers: {
        cookie: 'ids_visitor=legacy',
        'content-type': 'application/json',
        origin: 'http://localhost:5173',
      },
      ip: '203.0.113.9',
      socket: {},
    };
    const response = {};

    await expect(
      controller.register(
        request as never,
        response as never,
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
      ),
    ).resolves.toEqual({ authenticated: true, user: { id: 'user-1', username: 'writer' } });
    expect(auth.register).toHaveBeenCalledWith(
      expect.any(Object),
      '203.0.113.9',
      'ids_visitor=legacy',
    );
    expect(auth.setSessionCookie).toHaveBeenCalledWith(response, 'session-token');
    expect(auth.clearLegacyVisitorCookie).toHaveBeenCalledWith(response);
  });

  it('preserves the legacy cookie when project claiming cannot complete', async () => {
    const failure = Object.assign(new Error('legacy visitor unresolved'), { status: 409 });
    const auth = {
      assertMutationRequest: jest.fn(),
      register: jest.fn().mockRejectedValue(failure),
      setSessionCookie: jest.fn(),
      clearLegacyVisitorCookie: jest.fn(),
    };
    const controller = new AuthController(auth as never);

    await expect(
      controller.register(
        {
          headers: {
            cookie: 'ids_visitor=legacy',
            'content-type': 'application/json',
            origin: 'http://localhost:5173',
          },
          ip: '203.0.113.9',
          socket: {},
        } as never,
        {} as never,
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
      ),
    ).rejects.toBe(failure);
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
    expect(auth.clearLegacyVisitorCookie).not.toHaveBeenCalled();
  });

  it('applies the no-store interceptor to every authentication response', () => {
    expect(Reflect.getMetadata(INTERCEPTORS_METADATA, AuthController)).toEqual(
      expect.arrayContaining([AuthNoStoreInterceptor]),
    );
  });
});
