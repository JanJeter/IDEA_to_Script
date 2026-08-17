import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { VisitorRequest } from '../security/visitor-request';

@Injectable()
export class GenerationJobOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<VisitorRequest>();
    const jobId = request.params.jobId as string | undefined;
    const job = jobId
      ? await this.prisma.generationJob.findFirst({
          where: {
            id: jobId,
            project: { visitorId: request.visitorId, expiresAt: { gt: new Date() } },
          },
          select: { id: true },
        })
      : null;
    if (!job) throw new NotFoundException('生成任务不存在');
    return true;
  }
}
