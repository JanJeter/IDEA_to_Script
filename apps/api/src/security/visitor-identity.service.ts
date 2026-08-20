import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const COOKIE_NAME = 'ids_visitor';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_VISITOR_CACHE_SIZE = 10_000;
const DEVELOPMENT_COOKIE_KEY = 'development-cookie-signing-key-change-me';

type CachedVisitor = {
  id: string;
  lastSeenWrittenAt: number;
};

@Injectable()
export class VisitorIdentityService {
  readonly accessRequired: boolean;

  private readonly cookieSigningKey: string;
  private readonly previousCookieSigningKeys: string[];
  private readonly identityKey: string;
  private readonly secureCookie: boolean;
  private readonly lastSeenWriteIntervalMs: number;
  private readonly allowedSessionTokenHashes = new Set<string>();
  private readonly accessCodeTokens = new Map<string, string>();
  private readonly sessionIdentityTokens = new Map<string, string>();
  private readonly visitorCache = new Map<string, CachedVisitor>();

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.cookieSigningKey = (
      config.get<string>('COOKIE_SIGNING_KEY', DEVELOPMENT_COOKIE_KEY) ?? DEVELOPMENT_COOKIE_KEY
    ).trim();
    this.previousCookieSigningKeys = (config.get<string>('COOKIE_SIGNING_KEY_PREVIOUS', '') ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key && key !== this.cookieSigningKey);
    const configuredIdentityKey = config.get<string>('VISITOR_IDENTITY_KEY')?.trim();
    this.identityKey = configuredIdentityKey || this.cookieSigningKey;
    this.secureCookie =
      config.get<string>('VISITOR_COOKIE_SECURE', config.get('NODE_ENV') === 'production' ? 'true' : 'false') ===
      'true';
    this.accessRequired = config.get<string>('ACCESS_CONTROL_REQUIRED', 'false') === 'true';
    this.lastSeenWriteIntervalMs = this.integerConfig(
      config.get<string>('VISITOR_LAST_SEEN_WRITE_INTERVAL_MS'),
      DEFAULT_LAST_SEEN_INTERVAL_MS,
      10_000,
      24 * 60 * 60 * 1000,
    );

    const production = config.get('NODE_ENV') === 'production';
    if (production && this.cookieSigningKey.length < 32) {
      throw new Error('COOKIE_SIGNING_KEY must contain at least 32 characters in production');
    }
    if (production && this.cookieSigningKey === DEVELOPMENT_COOKIE_KEY) {
      throw new Error('COOKIE_SIGNING_KEY must not use the public development value in production');
    }
    if (production && (!configuredIdentityKey || this.identityKey.length < 32)) {
      throw new Error('VISITOR_IDENTITY_KEY must contain at least 32 characters in production');
    }
    if (production && this.identityKey === DEVELOPMENT_COOKIE_KEY) {
      throw new Error('VISITOR_IDENTITY_KEY must not use the public development value in production');
    }
    if (production && this.previousCookieSigningKeys.some((key) => key.length < 32)) {
      throw new Error('COOKIE_SIGNING_KEY_PREVIOUS entries must contain at least 32 characters');
    }
    if (production && this.previousCookieSigningKeys.includes(DEVELOPMENT_COOKIE_KEY)) {
      throw new Error('COOKIE_SIGNING_KEY_PREVIOUS must not contain the public development value');
    }

    const accessCodes = (config.get<string>('APP_ACCESS_CODES', '') ?? '')
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    if (new Set(accessCodes).size !== accessCodes.length) {
      throw new Error('APP_ACCESS_CODES entries must be unique');
    }
    for (const code of accessCodes) {
      const sessionToken = this.deriveAccessSessionToken(code);
      const identityToken = this.deriveSeatIdentityToken(this.seatIdentity(code));
      this.accessCodeTokens.set(this.accessCodeProof(code), sessionToken);
      this.sessionIdentityTokens.set(sessionToken, identityToken);
      this.allowedSessionTokenHashes.add(this.hashSessionToken(sessionToken));
    }

    if (this.accessRequired && accessCodes.length === 0) {
      throw new Error('APP_ACCESS_CODES must contain at least one code when ACCESS_CONTROL_REQUIRED=true');
    }
    if (production && !this.accessRequired) {
      throw new Error('ACCESS_CONTROL_REQUIRED must be true in production');
    }
    if (config.get('NODE_ENV') === 'production' && accessCodes.some((code) => code.length < 12)) {
      throw new Error('Every APP_ACCESS_CODES entry must contain at least 12 characters in production');
    }
  }

  readSignedToken(cookieHeader: string | undefined) {
    return this.verifySignedToken(this.parseCookies(cookieHeader)[COOKIE_NAME]);
  }

  readLegacyToken(cookieHeader: string | undefined) {
    return this.readSignedToken(cookieHeader);
  }

  createVisitorTokenHash() {
    return this.hashIdentityToken(randomBytes(32).toString('base64url'));
  }

  legacyVisitorTokenHashCandidates(token: string) {
    const identityTokens = [this.sessionIdentityTokens.get(token), token].filter(
      (candidate): candidate is string => Boolean(candidate),
    );
    return [...new Set(identityTokens.map((candidate) => this.hashIdentityToken(candidate)))];
  }

  needsCookieRefresh(cookieHeader: string | undefined) {
    const value = this.parseCookies(cookieHeader)[COOKIE_NAME];
    const token = this.verifySignedToken(value);
    return Boolean(token && value !== this.signToken(token));
  }

  createAnonymousToken() {
    return randomBytes(32).toString('base64url');
  }

  tokenForAccessCode(code: string) {
    return this.accessCodeTokens.get(this.accessCodeProof(code.trim()));
  }

  isAuthorizedToken(token: string | undefined) {
    return Boolean(token && this.allowedSessionTokenHashes.has(this.hashSessionToken(token)));
  }

  setCookie(response: Response, token: string) {
    response.cookie(COOKIE_NAME, this.signToken(token), {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: THIRTY_DAYS_MS,
    });
  }

  clearCookie(response: Response) {
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
    });
  }

  async resolveVisitor(token: string) {
    const identityToken = this.sessionIdentityTokens.get(token) ?? token;
    const tokenHash = this.hashIdentityToken(identityToken);
    const now = Date.now();
    const cached = this.visitorCache.get(tokenHash);
    if (cached && now - cached.lastSeenWrittenAt < this.lastSeenWriteIntervalMs) {
      return cached.id;
    }

    const visitor = await this.prisma.anonymousVisitor.upsert({
      where: { tokenHash },
      create: { tokenHash },
      update: { lastSeenAt: new Date(now) },
      select: { id: true },
    });
    this.cacheVisitor(tokenHash, { id: visitor.id, lastSeenWrittenAt: now });
    return visitor.id;
  }

  private cacheVisitor(tokenHash: string, visitor: CachedVisitor) {
    this.visitorCache.delete(tokenHash);
    this.visitorCache.set(tokenHash, visitor);
    if (this.visitorCache.size <= MAX_VISITOR_CACHE_SIZE) return;
    const oldestKey = this.visitorCache.keys().next().value as string | undefined;
    if (oldestKey) this.visitorCache.delete(oldestKey);
  }

  private seatIdentity(code: string) {
    const generatedSeat = code.match(/^(IDS-\d{3,})-[A-Za-z0-9_-]+$/);
    return generatedSeat?.[1] ?? code;
  }

  private accessCodeProof(code: string) {
    return createHmac('sha256', this.identityKey).update(`access-code\0${code}`).digest('hex');
  }

  private deriveAccessSessionToken(code: string) {
    return createHmac('sha256', this.identityKey)
      .update(`access-session\0${code}`)
      .digest('base64url');
  }

  private deriveSeatIdentityToken(seatIdentity: string) {
    return createHmac('sha256', this.identityKey)
      .update(`access-seat\0${seatIdentity}`)
      .digest('base64url');
  }

  private signToken(token: string) {
    return `${token}.${this.signature(token)}`;
  }

  private verifySignedToken(value: string | undefined) {
    if (!value) return undefined;
    const [token, signature, extra] = value.split('.');
    if (extra || !TOKEN_PATTERN.test(token ?? '') || !signature) return undefined;

    const received = Buffer.from(signature, 'base64url');
    for (const key of [this.cookieSigningKey, ...this.previousCookieSigningKeys]) {
      const expected = Buffer.from(this.signature(token, key), 'base64url');
      if (expected.length === received.length && timingSafeEqual(expected, received)) return token;
    }
    return undefined;
  }

  private signature(token: string, key = this.cookieSigningKey) {
    return createHmac('sha256', key).update(`cookie\0${token}`).digest('base64url');
  }

  private hashSessionToken(token: string) {
    return createHmac('sha256', this.identityKey).update(`session\0${token}`).digest('hex');
  }

  private hashIdentityToken(token: string) {
    return createHmac('sha256', this.identityKey).update(`visitor\0${token}`).digest('hex');
  }

  private parseCookies(header: string | undefined) {
    const result: Record<string, string> = {};
    for (const entry of header?.split(';') ?? []) {
      const separator = entry.indexOf('=');
      if (separator < 1) continue;
      const name = entry.slice(0, separator).trim();
      const value = entry.slice(separator + 1).trim();
      try {
        result[name] = decodeURIComponent(value);
      } catch {
        result[name] = value;
      }
    }
    return result;
  }

  private integerConfig(raw: string | undefined, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  }
}
