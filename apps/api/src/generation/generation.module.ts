import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { GenerationController } from './generation.controller';
import { GenerationJobOwnerGuard } from './generation-job-owner.guard';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationService } from './generation.service';
import { LlmService } from './llm.service';
import { ProjectRetentionService } from './project-retention.service';

@Module({
  imports: [AgentModule],
  controllers: [GenerationController],
  providers: [
    GenerationService,
    GenerationJobsService,
    GenerationQueueService,
    GenerationJobOwnerGuard,
    ProjectRetentionService,
    LlmService,
  ],
  exports: [GenerationQueueService, LlmService],
})
export class GenerationModule {}
