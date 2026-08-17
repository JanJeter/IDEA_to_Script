import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenerationJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GenerationQueueService } from './generation-queue.service';

@Injectable()
export class ProjectRetentionService implements OnModuleInit {
  private readonly logger = new Logger(ProjectRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: GenerationQueueService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('RESTORE_VERIFY_MODE', 'false') === 'true') return;
    await this.queue.registerCleanupWorker(async () => {
      const expired = await this.prisma.project.deleteMany({
        where: {
          expiresAt: { lte: new Date() },
          jobs: {
            none: {
              status: {
                in: [
                  GenerationJobStatus.QUEUED,
                  GenerationJobStatus.RUNNING,
                  GenerationJobStatus.RETRYING,
                ],
              },
            },
          },
        },
      });
      const visitorRetentionDays = this.integerConfig('VISITOR_RETENTION_DAYS', 30, 7, 365);
      const visitorCutoff = new Date(Date.now() - visitorRetentionDays * 24 * 60 * 60 * 1000);
      const orphanedVisitors = await this.prisma.anonymousVisitor.deleteMany({
        where: {
          lastSeenAt: { lt: visitorCutoff },
          projects: { none: {} },
        },
      });
      this.logger.log(
        `Retention cleanup completed; deleted ${expired.count} projects and ${orphanedVisitors.count} orphan visitors`,
      );
    });
    this.logger.log('Expired project cleanup worker registered');
  }

  private integerConfig(key: string, fallback: number, minimum: number, maximum: number) {
    const value = Number(this.config.get<string>(key, String(fallback)));
    if (!Number.isInteger(value) || value < minimum) return fallback;
    return Math.min(value, maximum);
  }
}
