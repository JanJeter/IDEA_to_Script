import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, UserStatus } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { AuthThrottleService } from './auth-throttle.service';
import { PasswordService } from './password.service';
import { VisitorIdentityService } from './visitor-identity.service';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type AuthenticatedIdentity = {
  userId: string;
  username: string;
  visitorId: string;
};

type IssuedAuthentication = {
  token: string;
  payload: ReturnType<AuthService['authenticatedPayload']>;
};

@Injectable()
export class AuthService {
  private readonly production: boolean;
  private readonly secureCookie: boolean;
  private readonly cookieName: string;
  private readonly trustedOrigin: string;
  private readonly sessionLifetimeMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly throttle: AuthThrottleService,
    private readonly visitorIdentity: VisitorIdentityService,
    config: ConfigService,
  ) {
    this.production = config.get('NODE_ENV') === 'production';
    this.secureCookie =
      config.get<string>('AUTH_COOKIE_SECURE', this.production ? 'true' : 'false') === 'true';
    this.cookieName = this.secureCookie ? '__Host-ids_session' : 'ids_session';
    this.sessionLifetimeMs =
      this.integerConfig(config.get<string>('AUTH_SESSION_DAYS'), 30, 1, 90) * 24 * 60 * 60 * 1000;

    let webOrigin: URL;
    try {
      webOrigin = new URL(config.get<string>('WEB_ORIGIN', 'http://localhost:5173'));
    } catch {
      throw new Error('WEB_ORIGIN must be an absolute HTTP(S) origin');
    }
    if (!['http:', 'https:'].includes(webOrigin.protocol)) {
      throw new Error('WEB_ORIGIN must be an absolute HTTP(S) origin');
    }
    this.trustedOrigin = webOrigin.origin;

    if (this.production && !this.secureCookie) {
      throw new Error('AUTH_COOKIE_SECURE must not be disabled in production');
    }
    if (this.production && webOrigin.protocol !== 'https:') {
      throw new Error('WEB_ORIGIN must use HTTPS when password authentication is enabled in production');
    }
  }

  async register(input: RegisterDto, clientIp: string, legacyCookieHeader?: string) {
    if (input.password !== input.passwordConfirmation) {
      throw new BadRequestException('两次输入的密码不一致');
    }
    const username = input.username.trim().normalize('NFKC');
    const usernameNormalized = this.normalizeIdentifier(username);
    await this.throttle.consumeRegistration(clientIp, usernameNormalized);

    const existing = await this.prisma.user.findUnique({
      where: { usernameNormalized },
      select: { id: true },
    });
    if (existing) throw new ConflictException('用户名已被占用');

    const legacyVisitorId = await this.resolveLegacyVisitor(legacyCookieHeader);
    const passwordHash = await this.passwords.hash(input.password);

    try {
      return await this.createUserAndSession(
        username,
        usernameNormalized,
        passwordHash,
        legacyVisitorId,
      );
    } catch (error) {
      if (legacyVisitorId && this.isMissingRecord(error)) {
        throw this.legacyVisitorConflict(
          'LEGACY_VISITOR_UNRESOLVED',
          '旧项目身份已失效，请保留当前浏览器数据并联系管理员',
        );
      }
      if (legacyVisitorId && this.isUniqueConflictFor(error, 'visitorId')) {
        throw this.legacyVisitorConflict(
          'LEGACY_VISITOR_CLAIMED',
          '该浏览器的旧项目已绑定其他账号，请直接登录或联系管理员',
        );
      }
      if (legacyVisitorId && this.isUniqueConflict(error)) {
        throw this.legacyVisitorConflict(
          'REGISTRATION_CONFLICT',
          '用户名已被占用，或旧项目已绑定其他账号',
        );
      }
      if (this.isUniqueConflict(error)) throw new ConflictException('用户名已被占用');
      throw error;
    }
  }

  async login(input: LoginDto, clientIp: string) {
    const identifier = this.normalizeIdentifier(input.identifier);
    await this.throttle.consumeLogin(clientIp, identifier);
    const user = await this.prisma.user.findUnique({
      where: { usernameNormalized: identifier },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        status: true,
      },
    });
    const passwordValid = await this.passwords.verify(user?.passwordHash, input.password);
    if (!user || user.status !== UserStatus.ACTIVE || !passwordValid) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const upgradedPasswordHash = this.passwords.needsRehash(user.passwordHash)
      ? await this.passwords.hash(input.password)
      : undefined;
    const token = this.createSessionToken();
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.user.updateMany({
        where: {
          id: user.id,
          status: UserStatus.ACTIVE,
          passwordHash: user.passwordHash,
        },
        data: {
          lastLoginAt: now,
          ...(upgradedPasswordHash ? { passwordHash: upgradedPasswordHash } : {}),
        },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('账号或密码错误');
      await transaction.authSession.create({
        data: {
          userId: user.id,
          tokenHash: this.hashSessionToken(token),
          expiresAt: new Date(now.getTime() + this.sessionLifetimeMs),
          lastSeenAt: now,
        },
      });
    });
    return { token, payload: this.authenticatedPayload(user) };
  }

  async session(cookieHeader: string | undefined) {
    const identity = await this.resolveSession(cookieHeader);
    return identity
      ? this.authenticatedPayload({ id: identity.userId, username: identity.username })
      : this.anonymousPayload();
  }

  async resolveSession(cookieHeader: string | undefined): Promise<AuthenticatedIdentity | undefined> {
    const token = this.readSessionToken(cookieHeader);
    if (!token) return undefined;
    const now = new Date();
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hashSessionToken(token) },
      select: {
        id: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
        user: {
          select: {
            id: true,
            username: true,
            visitorId: true,
            status: true,
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      return undefined;
    }

    if (now.getTime() - session.lastSeenAt.getTime() >= 5 * 60 * 1000) {
      await this.prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { lastSeenAt: now },
      });
    }
    return {
      userId: session.user.id,
      username: session.user.username,
      visitorId: session.user.visitorId,
    };
  }

  async logout(cookieHeader: string | undefined) {
    const token = this.readSessionToken(cookieHeader);
    if (token) {
      await this.prisma.authSession.updateMany({
        where: { tokenHash: this.hashSessionToken(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return this.anonymousPayload();
  }

  setSessionCookie(response: Response, token: string) {
    response.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
      maxAge: this.sessionLifetimeMs,
    });
  }

  clearSessionCookie(response: Response) {
    response.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
    });
  }

  clearLegacyVisitorCookie(response: Response) {
    response.clearCookie('ids_visitor', {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'lax',
      path: '/',
    });
  }

  assertMutationRequest(input: {
    contentType?: string;
    origin?: string;
    referer?: string;
    requireJson?: boolean;
  }) {
    if (input.requireJson && !input.contentType?.toLowerCase().startsWith('application/json')) {
      throw new ForbiddenException('登录请求格式无效');
    }

    let suppliedOrigin: string | undefined;
    try {
      suppliedOrigin = input.origin
        ? new URL(input.origin).origin
        : input.referer
          ? new URL(input.referer).origin
          : undefined;
    } catch {
      throw new ForbiddenException('登录请求来源无效');
    }
    if ((this.production && !suppliedOrigin) || (suppliedOrigin && suppliedOrigin !== this.trustedOrigin)) {
      throw new ForbiddenException('登录请求来源无效');
    }
  }

  private async createUserAndSession(
    username: string,
    usernameNormalized: string,
    passwordHash: string,
    legacyVisitorId?: string,
  ): Promise<IssuedAuthentication> {
    const token = this.createSessionToken();
    const now = new Date();
    const user = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.user.create({
        data: {
          username,
          usernameNormalized,
          passwordHash,
          lastLoginAt: now,
          visitor: legacyVisitorId
            ? { connect: { id: legacyVisitorId } }
            : { create: { tokenHash: this.visitorIdentity.createVisitorTokenHash() } },
        },
        select: { id: true, username: true },
      });
      await transaction.authSession.create({
        data: {
          userId: created.id,
          tokenHash: this.hashSessionToken(token),
          expiresAt: new Date(now.getTime() + this.sessionLifetimeMs),
          lastSeenAt: now,
        },
      });
      return created;
    });
    return { token, payload: this.authenticatedPayload(user) };
  }

  private authenticatedPayload(user: { id: string; username: string }) {
    return { authenticated: true as const, user: { id: user.id, username: user.username } };
  }

  private async resolveLegacyVisitor(cookieHeader: string | undefined) {
    const legacyToken = this.visitorIdentity.readLegacyToken(cookieHeader);
    if (!legacyToken) return undefined;
    const candidateHashes = this.visitorIdentity.legacyVisitorTokenHashCandidates(legacyToken);
    const candidates = await this.prisma.anonymousVisitor.findMany({
      where: { tokenHash: { in: candidateHashes } },
      select: { id: true, tokenHash: true, user: { select: { id: true } } },
    });
    const visitor = candidateHashes
      .map((tokenHash) => candidates.find((candidate) => candidate.tokenHash === tokenHash))
      .find((candidate) => candidate !== undefined);
    if (!visitor) {
      throw this.legacyVisitorConflict(
        'LEGACY_VISITOR_UNRESOLVED',
        '无法识别旧项目身份，请保留当前浏览器数据并联系管理员',
      );
    }
    if (visitor.user) {
      throw this.legacyVisitorConflict(
        'LEGACY_VISITOR_CLAIMED',
        '该浏览器的旧项目已绑定其他账号，请直接登录或联系管理员',
      );
    }
    return visitor.id;
  }

  private legacyVisitorConflict(code: string, message: string) {
    return new ConflictException({ message, code });
  }

  private anonymousPayload() {
    return { authenticated: false as const, user: null };
  }

  private normalizeIdentifier(value: string) {
    return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
  }

  private createSessionToken() {
    return randomBytes(32).toString('base64url');
  }

  private hashSessionToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private readSessionToken(cookieHeader: string | undefined) {
    const value = this.parseCookies(cookieHeader)[this.cookieName];
    return SESSION_TOKEN_PATTERN.test(value ?? '') ? value : undefined;
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

  private isUniqueConflict(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isUniqueConflictFor(error: unknown, field: string) {
    if (!this.isUniqueConflict(error)) return false;
    const target = error.meta?.target;
    return Array.isArray(target)
      ? target.some((entry) => String(entry).includes(field))
      : String(target ?? '').includes(field);
  }

  private isMissingRecord(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  }

  private integerConfig(raw: string | undefined, fallback: number, minimum: number, maximum: number) {
    const parsed = Number.parseInt(raw ?? '', 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }
}
