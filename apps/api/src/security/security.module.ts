import { Global, Module } from '@nestjs/common';
import { AbuseProtectionService } from './abuse-protection.service';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { VisitorIdentityService } from './visitor-identity.service';
import { VisitorMiddleware } from './visitor.middleware';

@Global()
@Module({
  controllers: [AccessController],
  providers: [AbuseProtectionService, AccessService, VisitorIdentityService, VisitorMiddleware],
  exports: [AbuseProtectionService, VisitorIdentityService, VisitorMiddleware],
})
export class SecurityModule {}
