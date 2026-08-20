import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthNoStoreInterceptor } from './auth-no-store.interceptor';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
@UseInterceptors(AuthNoStoreInterceptor)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.OK)
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: RegisterDto,
  ) {
    this.auth.assertMutationRequest({
      contentType: request.headers['content-type'],
      origin: request.headers.origin,
      referer: request.headers.referer,
      requireJson: true,
    });
    const result = await this.auth.register(input, this.clientIp(request), request.headers.cookie);
    this.auth.setSessionCookie(response, result.token);
    this.auth.clearLegacyVisitorCookie(response);
    return result.payload;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: LoginDto,
  ) {
    this.auth.assertMutationRequest({
      contentType: request.headers['content-type'],
      origin: request.headers.origin,
      referer: request.headers.referer,
      requireJson: true,
    });
    const result = await this.auth.login(input, this.clientIp(request));
    this.auth.setSessionCookie(response, result.token);
    return result.payload;
  }

  @Get('session')
  session(@Req() request: Request) {
    return this.auth.session(request.headers.cookie);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.auth.assertMutationRequest({
      origin: request.headers.origin,
      referer: request.headers.referer,
    });
    const result = await this.auth.logout(request.headers.cookie);
    this.auth.clearSessionCookie(response);
    return result;
  }

  private clientIp(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
