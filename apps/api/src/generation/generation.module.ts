import { Module } from '@nestjs/common';
import { AgentModelService } from '../agent/runtime/agent-model.service';
import { StageAgentRuntimeService } from '../agent/runtime/stage-agent-runtime.service';
import { StageSkillLoaderService } from '../agent/skills/stage-skill-loader.service';
import { PremiseAgentService } from '../agent/premise-agent.service';
import { GenerationController } from './generation.controller';
import { GenerationJobOwnerGuard } from './generation-job-owner.guard';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationQueueService } from './generation-queue.service';
import { GenerationService } from './generation.service';
import { LlmService } from './llm.service';
import { ProjectRetentionService } from './project-retention.service';

@Module({
  controllers: [GenerationController],
  providers: [
    GenerationService,
    GenerationJobsService,
    GenerationQueueService,
    GenerationJobOwnerGuard,
    ProjectRetentionService,
    LlmService,
    AgentModelService,
    StageAgentRuntimeService,
    StageSkillLoaderService,
    PremiseAgentService,
  ],
  exports: [GenerationQueueService, LlmService],
})
export class GenerationModule {}
