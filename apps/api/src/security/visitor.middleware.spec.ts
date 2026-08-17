import { ConfigService } from '@nestjs/config';
import { VisitorIdentityService } from './visitor-identity.service';
import { VisitorMiddleware } from './visitor.middleware';

describe('VisitorMiddleware', () => {
  it('issues a protected cookie and resolves the same anonymous visitor on the next request', async () => {
    const upsert = jest.fn().mockResolvedValue({ id: 'visitor-1' });
    const prisma = { anonymousVisitor: { upsert } };
    const identity = new VisitorIdentityService(
      new ConfigService({ COOKIE_SIGNING_KEY: 'a-secure-test-key-with-more-than-32-characters' }),
      prisma as never,
    );
    const middleware = new VisitorMiddleware(identity);
    const cookie = jest.fn();
    const next = jest.fn();
    const firstRequest = {
      headers: {},
      ip: '127.0.0.1',
      socket: {},
    };

    await middleware.use(firstRequest as never, { cookie } as never, next);

    expect(next).toHaveBeenCalledWith();
    expect(firstRequest).toMatchObject({ visitorId: 'visitor-1', clientIp: '127.0.0.1' });
    expect(cookie).toHaveBeenCalledWith(
      'ids_visitor',
      expect.stringMatching(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/),
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );

    const signedToken = cookie.mock.calls[0][1] as string;
    const secondCookie = jest.fn();
    const secondRequest = {
      headers: { cookie: `ids_visitor=${encodeURIComponent(signedToken)}` },
      ip: '127.0.0.1',
      socket: {},
    };
    await middleware.use(secondRequest as never, { cookie: secondCookie } as never, jest.fn());

    expect(secondCookie).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects weak production secrets during startup', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({ NODE_ENV: 'production', COOKIE_SIGNING_KEY: 'weak' }),
          {} as never,
        ),
    ).toThrow('COOKIE_SIGNING_KEY');
  });

  it('rejects the public development identity key in production', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({
            NODE_ENV: 'production',
            COOKIE_SIGNING_KEY: 'production-cookie-signing-key-with-more-than-32-characters',
            VISITOR_IDENTITY_KEY: '  development-cookie-signing-key-change-me  ',
            ACCESS_CONTROL_REQUIRED: 'true',
            APP_ACCESS_CODES: 'one-private-access-code',
          }),
          {} as never,
        ),
    ).toThrow('VISITOR_IDENTITY_KEY must not use the public development value');
  });

  it('rejects the public development cookie key with surrounding whitespace in production', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({
            NODE_ENV: 'production',
            COOKIE_SIGNING_KEY: '  development-cookie-signing-key-change-me  ',
            VISITOR_IDENTITY_KEY: 'production-identity-key-with-more-than-32-characters',
            ACCESS_CONTROL_REQUIRED: 'true',
            APP_ACCESS_CODES: 'one-private-access-code',
          }),
          {} as never,
        ),
    ).toThrow('COOKIE_SIGNING_KEY must not use the public development value');
  });

  it('rejects the public development previous cookie key with surrounding whitespace', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({
            NODE_ENV: 'production',
            COOKIE_SIGNING_KEY: 'production-cookie-signing-key-with-more-than-32-characters',
            COOKIE_SIGNING_KEY_PREVIOUS:
              '  development-cookie-signing-key-change-me  ',
            VISITOR_IDENTITY_KEY: 'production-identity-key-with-more-than-32-characters',
            ACCESS_CONTROL_REQUIRED: 'true',
            APP_ACCESS_CODES: 'one-private-access-code',
          }),
          {} as never,
        ),
    ).toThrow('COOKIE_SIGNING_KEY_PREVIOUS must not contain the public development value');
  });

  it('fails closed when a production deployment does not explicitly enable access control', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({
            NODE_ENV: 'production',
            COOKIE_SIGNING_KEY: 'production-cookie-signing-key-with-more-than-32-characters',
            VISITOR_IDENTITY_KEY: 'production-identity-key-with-more-than-32-characters',
            APP_ACCESS_CODES: 'one-private-access-code',
            ACCESS_CONTROL_REQUIRED: 'false',
          }),
          {} as never,
        ),
    ).toThrow('ACCESS_CONTROL_REQUIRED');
  });

  it('rejects requests without an authorized access-code cookie when the gate is enabled', async () => {
    const identity = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: 'a-secure-test-key-with-more-than-32-characters',
        ACCESS_CONTROL_REQUIRED: 'true',
        APP_ACCESS_CODES: 'one-private-access-code',
      }),
      { anonymousVisitor: { upsert: jest.fn() } } as never,
    );
    const middleware = new VisitorMiddleware(identity);
    const next = jest.fn();

    await middleware.use(
      { headers: {}, ip: '127.0.0.1', socket: {} } as never,
      { cookie: jest.fn() } as never,
      next,
    );

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }));
  });

  it('keeps the visitor identity stable while rotating and refreshing the cookie-signing key', async () => {
    const oldKey = 'old-cookie-signing-key-with-more-than-32-characters';
    const newKey = 'new-cookie-signing-key-with-more-than-32-characters';
    const identityKey = 'stable-visitor-identity-key-with-more-than-32-characters';
    const code = 'IDS-001-private-access-code';
    const oldUpsert = jest.fn().mockResolvedValue({ id: 'visitor-1' });
    const oldIdentity = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: oldKey,
        VISITOR_IDENTITY_KEY: identityKey,
        APP_ACCESS_CODES: code,
      }),
      { anonymousVisitor: { upsert: oldUpsert } } as never,
    );
    const oldResponse = { cookie: jest.fn() };
    const token = oldIdentity.tokenForAccessCode(code)!;
    oldIdentity.setCookie(oldResponse as never, token);
    await oldIdentity.resolveVisitor(token);
    const oldCookie = oldResponse.cookie.mock.calls[0][1] as string;

    const newUpsert = jest.fn().mockResolvedValue({ id: 'visitor-1' });
    const newIdentity = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: newKey,
        COOKIE_SIGNING_KEY_PREVIOUS: oldKey,
        VISITOR_IDENTITY_KEY: identityKey,
        APP_ACCESS_CODES: code,
      }),
      { anonymousVisitor: { upsert: newUpsert } } as never,
    );
    const refreshedCookie = jest.fn();
    await new VisitorMiddleware(newIdentity).use(
      { headers: { cookie: `ids_visitor=${encodeURIComponent(oldCookie)}` }, ip: '127.0.0.1', socket: {} } as never,
      { cookie: refreshedCookie } as never,
      jest.fn(),
    );

    expect(newIdentity.tokenForAccessCode(code)).toBe(token);
    expect(newUpsert.mock.calls[0][0].where.tokenHash).toBe(oldUpsert.mock.calls[0][0].where.tokenHash);
    expect(refreshedCookie).toHaveBeenCalledWith('ids_visitor', expect.any(String), expect.any(Object));
  });

  it('revokes an old access-code session while preserving the rotated seat identity', async () => {
    const cookieKey = 'cookie-signing-key-with-more-than-32-characters';
    const identityKey = 'stable-visitor-identity-key-with-more-than-32-characters';
    const oldCode = 'IDS-001-old-private-access-code';
    const newCode = 'IDS-001-new-private-access-code';
    const oldUpsert = jest.fn().mockResolvedValue({ id: 'visitor-1' });
    const oldIdentity = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: cookieKey,
        VISITOR_IDENTITY_KEY: identityKey,
        ACCESS_CONTROL_REQUIRED: 'true',
        APP_ACCESS_CODES: oldCode,
      }),
      { anonymousVisitor: { upsert: oldUpsert } } as never,
    );
    const oldSession = oldIdentity.tokenForAccessCode(oldCode)!;
    await oldIdentity.resolveVisitor(oldSession);

    const newUpsert = jest.fn().mockResolvedValue({ id: 'visitor-1' });
    const newIdentity = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: cookieKey,
        VISITOR_IDENTITY_KEY: identityKey,
        ACCESS_CONTROL_REQUIRED: 'true',
        APP_ACCESS_CODES: newCode,
      }),
      { anonymousVisitor: { upsert: newUpsert } } as never,
    );
    const newSession = newIdentity.tokenForAccessCode(newCode)!;
    await newIdentity.resolveVisitor(newSession);

    expect(newSession).not.toBe(oldSession);
    expect(newIdentity.isAuthorizedToken(oldSession)).toBe(false);
    expect(newIdentity.isAuthorizedToken(newSession)).toBe(true);
    expect(newUpsert.mock.calls[0][0].where.tokenHash).toBe(oldUpsert.mock.calls[0][0].where.tokenHash);
  });
});
