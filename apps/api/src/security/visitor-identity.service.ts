import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const LEGACY_COOKIE_NAME = 'ids_visitor';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEVELOPMENT_COOKIE_KEY = 'development-cookie-signing-key-change-me';

/**
 * Resolves the former signed visitor cookie so an account created in the same
 * browser can retain its projects. New authentication never issues this cookie.
 */
@Injectable()
export class VisitorIdentityService {
  private readonly cookieSigningKey: string;
  private readonly previousCookieSigningKeys: string[];
  private readonly identityKey: string;
  private readonly legacySessionIdentityTokens = new Map<string, string>();

  constructor(config: ConfigService) {
    this.cookieSigningKey = (
      config.get<string>('COOKIE_SIGNING_KEY', DEVELOPMENT_COOKIE_KEY) ?? DEVELOPMENT_COOKIE_KEY
    ).trim();
    this.previousCookieSigningKeys = (config.get<string>('COOKIE_SIGNING_KEY_PREVIOUS', '') ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key && key !== this.cookieSigningKey);
    const configuredIdentityKey = config.get<string>('VISITOR_IDENTITY_KEY')?.trim();
    this.identityKey = configuredIdentityKey || this.cookieSigningKey;

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

    // Keep the old seat derivation only long enough for a signed ids_visitor
    // cookie to claim its existing projects during account registration.
    for (const code of (config.get<string>('APP_ACCESS_CODES', '') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)) {
      this.legacySessionIdentityTokens.set(
        this.deriveAccessSessionToken(code),
        this.deriveSeatIdentityToken(this.seatIdentity(code)),
      );
    }
  }

  readLegacyToken(cookieHeader: string | undefined) {
    return this.verifySignedToken(this.parseCookies(cookieHeader)[LEGACY_COOKIE_NAME]);
  }

  createVisitorTokenHash() {
    return this.hashIdentityToken(randomBytes(32).toString('base64url'));
  }

  legacyVisitorTokenHashCandidates(token: string) {
    const identityTokens = [this.legacySessionIdentityTokens.get(token), token].filter(
      (candidate): candidate is string => Boolean(candidate),
    );
    return [...new Set(identityTokens.map((candidate) => this.hashIdentityToken(candidate)))];
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

  private seatIdentity(code: string) {
    return code.match(/^(IDS-\d{3,})-[A-Za-z0-9_-]+$/)?.[1] ?? code;
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
}
