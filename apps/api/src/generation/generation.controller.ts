import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthorizeGenerationDto } from '../security/dto/authorize-generation.dto';
import type { VisitorRequest } from '../security/visitor-request';
import { EnqueueGenerationDto } from './dto/enqueue-generation.dto';
import { RegenerateStageDto } from './dto/regenerate-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { GenerationJobOwnerGuard } from './generation-job-owner.guard';
import { GenerationJobsService } from './generation-jobs.service';
import { GenerationService } from './generation.service';

@Controller()
export class GenerationController {
  constructor(
    private readonly generation: GenerationService,
    private readonly jobs: GenerationJobsService,
  ) {}

  @Get('projects/:id/generate/challenge')
  challenge(@Req() request: VisitorRequest, @Param('id') id: string) {
    return this.generation.createChallenge(id, request.visitorId, request.clientIp);
  }

  @Post('projects/:id/generate/authorize')
  authorize(
    @Req() request: VisitorRequest,
    @Param('id') id: string,
    @Body() input: AuthorizeGenerationDto,
  ) {
    return this.generation.authorize(
      id,
      request.visitorId,
      request.clientIp,
      input.challenge,
      input.solution,
    );
  }

  @Post('projects/:id/generate/jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueue(
    @Req() request: VisitorRequest,
    @Param('id') id: string,
    @Body() input: EnqueueGenerationDto,
  ) {
    return this.jobs.enqueue(id, request.visitorId, input.ticket);
  }

  @Post('projects/:id/stages/:stage/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  regenerateStage(
    @Req() request: VisitorRequest,
    @Param('id') id: string,
    @Param('stage') stage: string,
    @Body() input: RegenerateStageDto,
  ) {
    return this.jobs.regenerateStage(id, request.visitorId, stage, input.ticket);
  }

  @Patch('projects/:id/stages/:stage')
  updateStage(
    @Req() request: VisitorRequest,
    @Param('id') id: string,
    @Param('stage') stage: string,
    @Body() input: UpdateStageDto,
  ) {
    return this.generation.updateStage(id, request.visitorId, stage, input.content);
  }

  @Post('projects/:id/stages/:stage/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  confirmStage(
    @Req() request: VisitorRequest,
    @Param('id') id: string,
    @Param('stage') stage: string,
  ) {
    return this.jobs.confirmStage(id, request.visitorId, stage);
  }

  @Get('projects/:id/generate/job')
  activeJob(@Req() request: VisitorRequest, @Param('id') id: string) {
    return this.jobs.getActiveForProject(id, request.visitorId);
  }

  @Get('jobs/:jobId')
  @UseGuards(GenerationJobOwnerGuard)
  job(@Req() request: VisitorRequest, @Param('jobId') jobId: string) {
    return this.jobs.get(jobId, request.visitorId);
  }

  @Sse('jobs/:jobId/events')
  @UseGuards(GenerationJobOwnerGuard)
  events(
    @Req() request: VisitorRequest,
    @Param('jobId') jobId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    const afterSequence = Number.parseInt(lastEventId ?? '0', 10);
    return this.jobs.events(jobId, request.visitorId, Number.isFinite(afterSequence) ? afterSequence : 0);
  }
}
