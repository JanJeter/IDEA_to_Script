import { Controller, Get } from '@nestjs/common';
import { LlmService } from './generation/llm.service';
import { PrismaService } from './prisma/prisma.service';
import { GenerationQueueService } from './generation/generation-queue.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly llm: LlmService,
    private readonly prisma: PrismaService,
    private readonly queue: GenerationQueueService,
  ) {}

  @Get()
  status() {
    return this.live();
  }

  @Get('live')
  live() {
    return this.payload();
  }

  @Get('ready')
  async ready() {
    await Promise.all([
      this.prisma.$queryRawUnsafe('SELECT 1'),
      this.queue.ready(),
    ]);
    return this.payload();
  }

  private payload() {
    return {
      status: 'ok',
      generationMode: this.llm.isDemo ? 'demo' : 'llm',
      model: this.llm.model,
      timestamp: new Date().toISOString(),
    };
  }
}
