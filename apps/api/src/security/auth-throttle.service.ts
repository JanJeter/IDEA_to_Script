import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

type ThrottleRow = {
  attempts: number;
  windowStartedAt: Date;
};

type ThrottleRule = {
  scope: string;
  subject: string;
  maximum: number;
  windowMs: number;
};

const DEVELOPMENT_THROTTLE_KEY = 'development-auth-throttle-key-change-me';

@Injectable()
export class AuthThrottleService {
  private readonly hashKey: string;
  private readonly loginGlobalMaximum: number;
  private readonly loginIpMaximum: number;
  private readonly loginIdentifierMaximum: number;
  private readonly loginWindowMs: number;
  private readonly registerGlobalMaximum: number;
  private readonly registerIpMaximum: number;
  private readonly registerUsernameMaximum: number;
  private readonly registerWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configuredHashKey = config.get<string>('AUTH_THROTTLE_KEY')?.trim();
    this.hashKey = (
      configuredHashKey ??
      config.get<string>('VISITOR_IDENTITY_KEY') ??
      config.get<string>('COOKIE_SIGNING_KEY') ??
      DEVELOPMENT_THROTTLE_KEY
    ).trim();
    this.loginWindowMs = this.durationMinutes(config, 'AUTH_LOGIN_WINDOW_MINUTES', 15);
    this.loginGlobalMaximum = this.integerConfig(config, 'AUTH_LOGIN_GLOBAL_MAX', 200, 10, 10_000);
    this.loginIpMaximum = this.integerConfig(config, 'AUTH_LOGIN_IP_MAX', 20, 3, 1_000);
    this.loginIdentifierMaximum = this.integerConfig(config, 'AUTH_LOGIN_IDENTIFIER_MAX', 10, 3, 1_000);
    this.registerWindowMs = this.durationMinutes(config, 'AUTH_REGISTER_WINDOW_MINUTES', 60);
    this.registerGlobalMaximum = this.integerConfig(config, 'AUTH_REGISTER_GLOBAL_MAX', 50, 5, 5_000);
    this.registerIpMaximum = this.integerConfig(config, 'AUTH_REGISTER_IP_MAX', 5, 1, 100);
    this.registerUsernameMaximum = this.integerConfig(config, 'AUTH_REGISTER_USERNAME_MAX', 5, 1, 100);

    if (
      config.get('NODE_ENV') === 'production' &&
      (!configuredHashKey ||
        configuredHashKey.length < 32 ||
        configuredHashKey === DEVELOPMENT_THROTTLE_KEY)
    ) {
      throw new Error('AUTH_THROTTLE_KEY must be a private value containing at least 32 characters');
    }
  }

  async consumeLogin(clientIp: string, normalizedIdentifier: string) {
    await this.consume({
      scope: 'login-ip',
      subject: clientIp,
      maximum: this.loginIpMaximum,
      windowMs: this.loginWindowMs,
    });
    await this.consume({
      scope: 'login-identifier',
      subject: normalizedIdentifier,
      maximum: this.loginIdentifierMaximum,
      windowMs: this.loginWindowMs,
    });
    await this.consume({
      scope: 'login-global',
      subject: 'global',
      maximum: this.loginGlobalMaximum,
      windowMs: this.loginWindowMs,
    });
  }

  async consumeRegistration(clientIp: string, normalizedUsername: string) {
    await this.consume({
      scope: 'register-ip',
      subject: clientIp,
      maximum: this.registerIpMaximum,
      windowMs: this.registerWindowMs,
    });
    await this.consume({
      scope: 'register-username',
      subject: normalizedUsername,
      maximum: this.registerUsernameMaximum,
      windowMs: this.registerWindowMs,
    });
    await this.consume({
      scope: 'register-global',
      subject: 'global',
      maximum: this.registerGlobalMaximum,
      windowMs: this.registerWindowMs,
    });
  }

  private async consume(rule: ThrottleRule) {
    const now = new Date();
    const resetBefore = new Date(now.getTime() - rule.windowMs);
    const subjectHash = createHmac('sha256', this.hashKey).update(rule.subject).digest('hex');
    const key = `${rule.scope}:${subjectHash}`;
    const rows = await this.prisma.$queryRaw<ThrottleRow[]>`
      INSERT INTO "AuthThrottle"
        ("key", "scope", "subjectHash", "windowStartedAt", "attempts", "createdAt", "updatedAt")
      VALUES
        (${key}, ${rule.scope}, ${subjectHash}, ${now}, 1, ${now}, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "windowStartedAt" = CASE
          WHEN "AuthThrottle"."windowStartedAt" <= ${resetBefore} THEN ${now}
          ELSE "AuthThrottle"."windowStartedAt"
        END,
        "attempts" = CASE
          WHEN "AuthThrottle"."windowStartedAt" <= ${resetBefore} THEN 1
          ELSE "AuthThrottle"."attempts" + 1
        END,
        "updatedAt" = ${now}
      RETURNING "attempts", "windowStartedAt"
    `;
    const current = rows[0];
    if (!current || current.attempts <= rule.maximum) return;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(current.windowStartedAt).getTime() + rule.windowMs - now.getTime()) / 1000),
    );
    throw new HttpException(
      { message: '尝试次数过多，请稍后再试', retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private durationMinutes(config: ConfigService, key: string, fallback: number) {
    return this.integerConfig(config, key, fallback, 1, 24 * 60) * 60 * 1000;
  }

  private integerConfig(
    config: ConfigService,
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) {
    const parsed = Number.parseInt(config.get<string>(key, String(fallback)), 10);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  }
}
