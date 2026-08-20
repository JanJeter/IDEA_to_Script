import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { AuthService } from './auth.service';
import type { VisitorRequest } from './visitor-request';

@Injectable()
export class VisitorMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: VisitorRequest, _res: Response, next: NextFunction) {
    try {
      req.clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const method = (req.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        this.auth.assertMutationRequest({
          origin: req.headers.origin,
          referer: req.headers.referer,
        });
      }
      const identity = await this.auth.resolveSession(req.headers.cookie);
      if (!identity) throw new UnauthorizedException('请先登录');
      req.visitorId = identity.visitorId;
      req.userId = identity.userId;
      req.username = identity.username;
      next();
    } catch (error) {
      next(error);
    }
  }
}
