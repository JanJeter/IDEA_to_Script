import { Global, Module } from '@nestjs/common';
import { AbuseProtectionService } from './abuse-protection.service';
import { AuthController } from './auth.controller';
import { AuthNoStoreInterceptor } from './auth-no-store.interceptor';
import { AuthService } from './auth.service';
import { AuthThrottleService } from './auth-throttle.service';
import { PasswordService } from './password.service';
import { VisitorIdentityService } from './visitor-identity.service';
import { VisitorMiddleware } from './visitor.middleware';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AbuseProtectionService,
    AuthNoStoreInterceptor,
    AuthService,
    AuthThrottleService,
    PasswordService,
    VisitorIdentityService,
    VisitorMiddleware,
  ],
  exports: [AbuseProtectionService, AuthService, VisitorMiddleware],
})
export class SecurityModule {}
