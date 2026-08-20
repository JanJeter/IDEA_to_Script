import { UnauthorizedException } from '@nestjs/common';
import { VisitorMiddleware } from './visitor.middleware';

describe('VisitorMiddleware', () => {
  it('maps an authenticated account session to the existing visitor identity', async () => {
    const auth = {
      assertMutationRequest: jest.fn(),
      resolveSession: jest.fn().mockResolvedValue({
        userId: 'user-1',
        username: 'writer',
        visitorId: 'visitor-1',
      }),
    };
    const middleware = new VisitorMiddleware(auth as never);
    const next = jest.fn();
    const request = {
      headers: { cookie: 'ids_session=token' },
      ip: '127.0.0.1',
      socket: {},
    };

    await middleware.use(request as never, {} as never, next);

    expect(auth.resolveSession).toHaveBeenCalledWith('ids_session=token');
    expect(request).toMatchObject({
      userId: 'user-1',
      username: 'writer',
      visitorId: 'visitor-1',
      clientIp: '127.0.0.1',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects business APIs without a valid account session', async () => {
    const auth = {
      assertMutationRequest: jest.fn(),
      resolveSession: jest.fn().mockResolvedValue(undefined),
    };
    const middleware = new VisitorMiddleware(auth as never);
    const next = jest.fn();

    await middleware.use(
      { headers: {}, ip: '127.0.0.1', socket: {} } as never,
      {} as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedException));
  });

  it('forwards session-store failures to Nest error handling', async () => {
    const failure = new Error('database unavailable');
    const auth = {
      assertMutationRequest: jest.fn(),
      resolveSession: jest.fn().mockRejectedValue(failure),
    };
    const next = jest.fn();

    await new VisitorMiddleware(auth as never).use(
      { headers: {}, socket: { remoteAddress: '203.0.113.10' } } as never,
      {} as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(failure);
  });

  it('applies exact-origin validation to every protected write request', async () => {
    const auth = {
      assertMutationRequest: jest.fn(),
      resolveSession: jest.fn().mockResolvedValue({
        userId: 'user-1',
        username: 'writer',
        visitorId: 'visitor-1',
      }),
    };
    const next = jest.fn();

    await new VisitorMiddleware(auth as never).use(
      {
        method: 'PATCH',
        headers: {
          cookie: 'ids_session=token',
          origin: 'https://screenplay.example',
        },
        ip: '203.0.113.10',
        socket: {},
      } as never,
      {} as never,
      next,
    );

    expect(auth.assertMutationRequest).toHaveBeenCalledWith({
      origin: 'https://screenplay.example',
      referer: undefined,
    });
    expect(auth.resolveSession).toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a cross-origin write before reading the account session', async () => {
    const failure = new Error('登录请求来源无效');
    const auth = {
      assertMutationRequest: jest.fn(() => {
        throw failure;
      }),
      resolveSession: jest.fn(),
    };
    const next = jest.fn();

    await new VisitorMiddleware(auth as never).use(
      {
        method: 'POST',
        headers: { origin: 'https://attacker.example' },
        ip: '203.0.113.10',
        socket: {},
      } as never,
      {} as never,
      next,
    );

    expect(auth.resolveSession).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(failure);
  });
});
