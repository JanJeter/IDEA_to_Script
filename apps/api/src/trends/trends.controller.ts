import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { VisitorRequest } from '../security/visitor-request';
import { TrendBriefService } from './trend-brief.service';
import { TrendsService } from './trends.service';

@Controller('trends')
export class TrendsController {
  constructor(
    private readonly trends: TrendsService,
    private readonly briefs: TrendBriefService,
  ) {}

  @Get()
  list() {
    return this.trends.list();
  }

  @Post('refresh')
  refresh(@Req() request: VisitorRequest) {
    return this.trends.refreshManual(request.clientIp);
  }

  @Get(':id/brief')
  brief(@Param('id') id: string) {
    return this.briefs.getBrief(id);
  }
}
