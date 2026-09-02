import { createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { VisitorIdentityService } from './visitor-identity.service';

const COOKIE_KEY = 'cookie-signing-key-with-more-than-32-characters';
const IDENTITY_KEY = 'visitor-identity-key-with-more-than-32-characters';
const prisma = { anonymousVisitor: { upsert: jest.fn() } } as never;

describe('VisitorIdentityService', () => {
  it('accepts a valid former visitor cookie for project claiming', () => {
    const token = Buffer.alloc(32, 7).toString('base64url');
    const signature = createHmac('sha256', COOKIE_KEY)
      .update(`cookie\0${token}`)
      .digest('base64url');
    const service = new VisitorIdentityService(
      new ConfigService({ COOKIE_SIGNING_KEY: COOKIE_KEY, VISITOR_IDENTITY_KEY: IDENTITY_KEY }),
      prisma,
    );

    expect(service.readLegacyToken(`ids_visitor=${token}.${signature}`)).toBe(token);
    expect(service.readLegacyToken(`ids_visitor=${token}.invalid`)).toBeUndefined();
  });

  it('reproduces the former stable seat identity when access codes are still configured', () => {
    const code = 'IDS-001-a-long-private-code';
    const sessionToken = createHmac('sha256', IDENTITY_KEY)
      .update(`access-session\0${code}`)
      .digest('base64url');
    const seatToken = createHmac('sha256', IDENTITY_KEY)
      .update('access-seat\0IDS-001')
      .digest('base64url');
    const expectedHash = createHmac('sha256', IDENTITY_KEY)
      .update(`visitor\0${seatToken}`)
      .digest('hex');
    const service = new VisitorIdentityService(
      new ConfigService({
        COOKIE_SIGNING_KEY: COOKIE_KEY,
        VISITOR_IDENTITY_KEY: IDENTITY_KEY,
        APP_ACCESS_CODES: code,
      }),
      prisma,
    );

    expect(service.legacyVisitorTokenHashCandidates(sessionToken)[0]).toBe(expectedHash);
  });

  it('only returns a lookup candidate when the old access-code mapping is unavailable', () => {
    const token = Buffer.alloc(32, 9).toString('base64url');
    const expectedHash = createHmac('sha256', IDENTITY_KEY)
      .update(`visitor\0${token}`)
      .digest('hex');
    const service = new VisitorIdentityService(
      new ConfigService({ COOKIE_SIGNING_KEY: COOKIE_KEY, VISITOR_IDENTITY_KEY: IDENTITY_KEY }),
      prisma,
    );

    expect(service.legacyVisitorTokenHashCandidates(token)).toEqual([expectedHash]);
  });

  it('creates opaque, distinct visitor storage hashes for new accounts', () => {
    const service = new VisitorIdentityService(
      new ConfigService({ COOKIE_SIGNING_KEY: COOKIE_KEY, VISITOR_IDENTITY_KEY: IDENTITY_KEY }),
      prisma,
    );

    const first = service.createVisitorTokenHash();
    const second = service.createVisitorTokenHash();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toBe(second);
  });

  it('still fails closed on weak production identity secrets', () => {
    expect(
      () =>
        new VisitorIdentityService(
          new ConfigService({ NODE_ENV: 'production', COOKIE_SIGNING_KEY: 'weak' }),
          prisma,
        ),
    ).toThrow('COOKIE_SIGNING_KEY');
  });
});
