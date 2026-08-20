import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VisitorIdentityService } from './visitor-identity.service';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 10_000;

@Injectable()
export class AccessService {
  private readonly failedAttempts = new Map<string, number[]>();
  private readonly trustedOrigin: string;
  private readonly production: boolean;

  constructor(
    private readonly identity: VisitorIdentityService,
    config: ConfigService,
  ) {
    this.production = config.get('NODE_ENV') === 'production';
    try {
      this.trustedOrigin = new URL(config.get<string>('WEB_ORIGIN', 'http://localhost:5173')).origin;
    } catch {
      throw new Error('WEB_ORIGIN must be an absolute HTTP(S) origin');
    }
  }

  assertAuthorizeRequest(input: {
    marker?: string;
    contentType?: string;
    origin?: string;
    referer?: string;
  }) {
    if (input.marker !== 'authorize' || !input.contentType?.toLowerCase().startsWith('application/json')) {
      throw new ForbiddenException('访问码请求校验失败');
    }

    let suppliedOrigin: string | undefined;
    try {
      suppliedOrigin = input.origin
        ? new URL(input.origin).origin
        : input.referer
          ? new URL(input.referer).origin
          : undefined;
    } catch {
      throw new ForbiddenException('访问码请求来源无效');
    }
    if ((this.production && !suppliedOrigin) || (suppliedOrigin && suppliedOrigin !== this.trustedOrigin)) {
      throw new ForbiddenException('访问码请求来源无效');
    }
  }

  session(cookieHeader: string | undefined) {
    const token = this.identity.readSignedToken(cookieHeader);
    return {
      required: this.identity.accessRequired,
      authorized: !this.identity.accessRequired || this.identity.isAuthorizedToken(token),
    };
  }

  async authorize(code: string, clientIp: string) {
    const token = this.identity.tokenForAccessCode(code);
    if (token) {
      await this.identity.resolveVisitor(token);
      return token;
    }

    const now = Date.now();
    const recentFailures = (this.failedAttempts.get(clientIp) ?? []).filter(
      (attemptedAt) => now - attemptedAt < WINDOW_MS,
    );
    if (recentFailures.length >= MAX_FAILURES_PER_WINDOW) {
      this.failedAttempts.set(clientIp, recentFailures);
      throw new HttpException('尝试次数过多，请 10 分钟后再试', HttpStatus.TOO_MANY_REQUESTS);
    }

    recentFailures.push(now);
    this.failedAttempts.delete(clientIp);
    this.failedAttempts.set(clientIp, recentFailures);
    if (this.failedAttempts.size > MAX_TRACKED_IPS) {
      const oldestIp = this.failedAttempts.keys().next().value as string | undefined;
      if (oldestIp) this.failedAttempts.delete(oldestIp);
    }
    throw new UnauthorizedException('访问码无效');
  }
}
