import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { VisitorRequest } from './visitor-request';
import { VisitorIdentityService } from './visitor-identity.service';

@Injectable()
export class VisitorMiddleware implements NestMiddleware {
  constructor(private readonly identity: VisitorIdentityService) {}

  async use(req: VisitorRequest, res: Response, next: NextFunction) {
    try {
      const existingToken = this.identity.readSignedToken(req.headers.cookie);
      if (this.identity.accessRequired && !this.identity.isAuthorizedToken(existingToken)) {
        throw new UnauthorizedException('需要有效访问码');
      }
      const token = existingToken ?? this.identity.createAnonymousToken();

      if (!existingToken || this.identity.needsCookieRefresh(req.headers.cookie)) {
        this.identity.setCookie(res, token);
      }

      req.visitorId = await this.identity.resolveVisitor(token);
      req.clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      next();
    } catch (error) {
      next(error);
    }
  }

}
