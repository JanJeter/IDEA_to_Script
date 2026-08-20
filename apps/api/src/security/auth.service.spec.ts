import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';

function createSubject(config: Record<string, string> = {}) {
  const transaction = {
    user: {
      create: jest.fn().mockResolvedValue({ id: 'user-1', username: 'Writer' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    authSession: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    anonymousVisitor: { findMany: jest.fn().mockResolvedValue([]) },
    authSession: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation((operation) =>
      typeof operation === 'function' ? operation(transaction) : Promise.all(operation),
    ),
  };
  const passwords = {
    hash: jest.fn().mockResolvedValue('argon2-password-hash'),
    verify: jest.fn(),
    needsRehash: jest.fn().mockReturnValue(false),
  };
  const throttle = {
    consumeRegistration: jest.fn().mockResolvedValue(undefined),
    consumeLogin: jest.fn().mockResolvedValue(undefined),
  };
  const visitorIdentity = {
    readLegacyToken: jest.fn(),
    legacyVisitorTokenHashCandidates: jest.fn().mockReturnValue(['legacy-token-hash']),
    createVisitorTokenHash: jest.fn().mockReturnValue('new-visitor-token-hash'),
  };
  const service = new AuthService(
    prisma as never,
    passwords as never,
    throttle as never,
    visitorIdentity as never,
    new ConfigService(config),
  );
  return { service, prisma, transaction, passwords, throttle, visitorIdentity };
}

describe('AuthService', () => {
  it('registers a normalized username, creates a visitor and logs in atomically', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);

    const result = await subject.service.register(
      {
        username: ' Ｗriter ',
        password: 'long password value',
        passwordConfirmation: 'long password value',
      },
      '203.0.113.7',
    );

    expect(subject.throttle.consumeRegistration).toHaveBeenCalledWith('203.0.113.7', 'writer');
    expect(subject.passwords.hash).toHaveBeenCalledWith('long password value');
    expect(subject.transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'Writer',
          usernameNormalized: 'writer',
          passwordHash: 'argon2-password-hash',
          visitor: { create: { tokenHash: 'new-visitor-token-hash' } },
        }),
      }),
    );
    expect(subject.transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        expiresAt: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      payload: { authenticated: true, user: { id: 'user-1', username: 'Writer' } },
    });
  });

  it('connects a valid former visitor identity so its projects are retained', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);
    subject.visitorIdentity.readLegacyToken.mockReturnValue('legacy-token');
    subject.prisma.anonymousVisitor.findMany.mockResolvedValue([
      { id: 'legacy-visitor', tokenHash: 'legacy-token-hash', user: null },
    ]);

    await subject.service.register(
      {
        username: 'writer',
        password: 'long password value',
        passwordConfirmation: 'long password value',
      },
      '203.0.113.7',
      'ids_visitor=signed-value',
    );

    expect(subject.visitorIdentity.legacyVisitorTokenHashCandidates).toHaveBeenCalledWith(
      'legacy-token',
    );
    expect(subject.transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          visitor: {
            connect: { id: 'legacy-visitor' },
          },
        }),
      }),
    );
  });

  it('does not create a user or discard the cookie when a valid legacy cookie cannot be mapped', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);
    subject.visitorIdentity.readLegacyToken.mockReturnValue('legacy-token');
    subject.prisma.anonymousVisitor.findMany.mockResolvedValue([]);

    await expect(
      subject.service.register(
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
        '203.0.113.7',
        'ids_visitor=signed-value',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'LEGACY_VISITOR_UNRESOLVED' }),
    });
    expect(subject.passwords.hash).not.toHaveBeenCalled();
    expect(subject.transaction.user.create).not.toHaveBeenCalled();
  });

  it('refuses to silently replace a legacy identity already claimed by another account', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);
    subject.visitorIdentity.readLegacyToken.mockReturnValue('legacy-token');
    subject.prisma.anonymousVisitor.findMany.mockResolvedValue([
      { id: 'legacy-visitor', tokenHash: 'legacy-token-hash', user: { id: 'other-user' } },
    ]);

    await expect(
      subject.service.register(
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
        '203.0.113.7',
        'ids_visitor=signed-value',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'LEGACY_VISITOR_CLAIMED' }),
    });
    expect(subject.passwords.hash).not.toHaveBeenCalled();
  });

  it('reports a claim conflict if another registration wins the legacy visitor race', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);
    subject.visitorIdentity.readLegacyToken.mockReturnValue('legacy-token');
    subject.prisma.anonymousVisitor.findMany.mockResolvedValue([
      { id: 'legacy-visitor', tokenHash: 'legacy-token-hash', user: null },
    ]);
    subject.transaction.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['visitorId'] },
      }),
    );

    await expect(
      subject.service.register(
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
        '203.0.113.7',
        'ids_visitor=signed-value',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'LEGACY_VISITOR_CLAIMED' }),
    });
    expect(subject.transaction.user.create).toHaveBeenCalledTimes(1);
    expect(subject.visitorIdentity.createVisitorTokenHash).not.toHaveBeenCalled();
  });

  it('rejects mismatched password confirmation before rate limiting or hashing', async () => {
    const subject = createSubject();

    await expect(
      subject.service.register(
        { username: 'writer', password: 'first password value', passwordConfirmation: 'other value' },
        '203.0.113.7',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(subject.throttle.consumeRegistration).not.toHaveBeenCalled();
    expect(subject.passwords.hash).not.toHaveBeenCalled();
  });

  it('rejects an occupied username before expensive password hashing', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

    await expect(
      subject.service.register(
        {
          username: 'writer',
          password: 'long password value',
          passwordConfirmation: 'long password value',
        },
        '203.0.113.7',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(subject.passwords.hash).not.toHaveBeenCalled();
  });

  it('uses a dummy password verification and a uniform error for an unknown account', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue(null);
    subject.passwords.verify.mockResolvedValue(false);

    await expect(
      subject.service.login({ identifier: 'Missing', password: 'wrong password' }, '203.0.113.8'),
    ).rejects.toMatchObject({
      status: 401,
      response: { message: '账号或密码错误', statusCode: 401 },
    });
    expect(subject.throttle.consumeLogin).toHaveBeenCalledWith('203.0.113.8', 'missing');
    expect(subject.passwords.verify).toHaveBeenCalledWith(undefined, 'wrong password');
  });

  it('issues a database-backed opaque session after a valid login', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'Writer',
      passwordHash: 'stored-hash',
      status: UserStatus.ACTIVE,
    });
    subject.passwords.verify.mockResolvedValue(true);

    const result = await subject.service.login(
      { identifier: 'Writer', password: 'long password value' },
      '203.0.113.8',
    );

    expect(subject.transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', status: UserStatus.ACTIVE, passwordHash: 'stored-hash' },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(subject.transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(result.payload).toEqual({
      authenticated: true,
      user: { id: 'user-1', username: 'Writer' },
    });
  });

  it('upgrades an outdated Argon2 hash after a successful login', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'Writer',
      passwordHash: 'old-argon2-hash',
      status: UserStatus.ACTIVE,
    });
    subject.passwords.verify.mockResolvedValue(true);
    subject.passwords.needsRehash.mockReturnValue(true);
    subject.passwords.hash.mockResolvedValue('upgraded-argon2-hash');

    await subject.service.login(
      { identifier: 'writer', password: 'long password value' },
      '203.0.113.8',
    );

    expect(subject.passwords.hash).toHaveBeenCalledWith('long password value');
    expect(subject.transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1', status: UserStatus.ACTIVE, passwordHash: 'old-argon2-hash' },
      data: { lastLoginAt: expect.any(Date), passwordHash: 'upgraded-argon2-hash' },
    });
  });

  it('does not issue a session if an administrator reset wins after password verification', async () => {
    const subject = createSubject();
    subject.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      username: 'Writer',
      passwordHash: 'password-hash-before-reset',
      status: UserStatus.ACTIVE,
    });
    subject.passwords.verify.mockResolvedValue(true);
    subject.transaction.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      subject.service.login(
        { identifier: 'writer', password: 'password known before reset' },
        '203.0.113.8',
      ),
    ).rejects.toMatchObject({
      status: 401,
      response: expect.objectContaining({ message: '账号或密码错误' }),
    });
    expect(subject.transaction.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user-1',
        status: UserStatus.ACTIVE,
        passwordHash: 'password-hash-before-reset',
      },
      data: { lastLoginAt: expect.any(Date) },
    });
    expect(subject.transaction.authSession.create).not.toHaveBeenCalled();
  });

  it('resolves a valid session to the visitor identity used by existing APIs', async () => {
    const subject = createSubject();
    subject.prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      lastSeenAt: new Date(),
      user: {
        id: 'user-1',
        username: 'Writer',
        visitorId: 'visitor-1',
        status: UserStatus.ACTIVE,
      },
    });
    const response = { cookie: jest.fn() };
    const loginToken = 'a'.repeat(43);

    expect(await subject.service.resolveSession(`ids_session=${loginToken}`)).toEqual({
      userId: 'user-1',
      username: 'Writer',
      visitorId: 'visitor-1',
    });
    subject.service.setSessionCookie(response as never, loginToken);
    expect(response.cookie).toHaveBeenCalledWith(
      'ids_session',
      loginToken,
      expect.objectContaining({ httpOnly: true, secure: false, sameSite: 'lax', path: '/' }),
    );
  });

  it.each([
    ['revoked', { revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), status: UserStatus.ACTIVE }],
    ['expired', { revokedAt: null, expiresAt: new Date(Date.now() - 60_000), status: UserStatus.ACTIVE }],
    ['disabled', { revokedAt: null, expiresAt: new Date(Date.now() + 60_000), status: UserStatus.DISABLED }],
  ])('rejects a %s database session', async (_label, state) => {
    const subject = createSubject();
    subject.prisma.authSession.findUnique.mockResolvedValue({
      id: 'session-1',
      expiresAt: state.expiresAt,
      revokedAt: state.revokedAt,
      lastSeenAt: new Date(),
      user: {
        id: 'user-1',
        username: 'Writer',
        visitorId: 'visitor-1',
        status: state.status,
      },
    });

    await expect(subject.service.resolveSession(`ids_session=${'d'.repeat(43)}`)).resolves.toBeUndefined();
  });

  it('revokes the current session and makes logout idempotent', async () => {
    const subject = createSubject();
    const token = 'b'.repeat(43);

    await expect(subject.service.logout(`ids_session=${token}`)).resolves.toEqual({
      authenticated: false,
      user: null,
    });
    expect(subject.prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    await expect(subject.service.logout(undefined)).resolves.toEqual({
      authenticated: false,
      user: null,
    });
  });

  it('fails closed if production is not configured for HTTPS secure cookies', () => {
    expect(() =>
      createSubject({
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'true',
        WEB_ORIGIN: 'http://example.com',
      }),
    ).toThrow('WEB_ORIGIN must use HTTPS');
    expect(() =>
      createSubject({
        NODE_ENV: 'production',
        AUTH_COOKIE_SECURE: 'false',
        WEB_ORIGIN: 'https://example.com',
      }),
    ).toThrow('AUTH_COOKIE_SECURE');
  });

  it('uses the __Host- cookie contract in a valid production configuration', () => {
    const subject = createSubject({
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'true',
      WEB_ORIGIN: 'https://screenplay.example',
    });
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };

    subject.service.setSessionCookie(response as never, 'c'.repeat(43));
    subject.service.clearSessionCookie(response as never);

    expect(response.cookie).toHaveBeenCalledWith(
      '__Host-ids_session',
      'c'.repeat(43),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      '__Host-ids_session',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('requires JSON and rejects cross-origin authentication mutations', () => {
    const subject = createSubject();

    expect(() =>
      subject.service.assertMutationRequest({
        contentType: 'text/plain',
        origin: 'http://localhost:5173',
        requireJson: true,
      }),
    ).toThrow('登录请求格式无效');
    expect(() =>
      subject.service.assertMutationRequest({
        contentType: 'application/json',
        origin: 'https://attacker.example',
        requireJson: true,
      }),
    ).toThrow('登录请求来源无效');
  });

  it('rejects a production mutation when both Origin and Referer are absent', () => {
    const subject = createSubject({
      NODE_ENV: 'production',
      AUTH_COOKIE_SECURE: 'true',
      WEB_ORIGIN: 'https://screenplay.example',
    });

    expect(() =>
      subject.service.assertMutationRequest({
        contentType: 'application/json',
        requireJson: true,
      }),
    ).toThrow('登录请求来源无效');
  });
});
