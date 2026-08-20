import { Body, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccessService } from './access.service';
import { AuthorizeAccessDto } from './dto/authorize-access.dto';
import { VisitorIdentityService } from './visitor-identity.service';

@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly identity: VisitorIdentityService,
  ) {}

  @Get('session')
  session(@Req() request: Request) {
    return this.access.session(request.headers.cookie);
  }

  @Post('authorize')
  async authorize(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: AuthorizeAccessDto,
    @Headers('x-ids-access') marker?: string,
    @Headers('content-type') contentType?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    this.access.assertAuthorizeRequest({ marker, contentType, origin, referer });
    const token = await this.access.authorize(
      input.code,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    this.identity.setCookie(response, token);
    return { required: this.identity.accessRequired, authorized: true };
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) response: Response) {
    this.identity.clearCookie(response);
    return { required: this.identity.accessRequired, authorized: !this.identity.accessRequired };
  }
}
