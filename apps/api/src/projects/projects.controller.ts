import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { VisitorRequest } from '../security/visitor-request';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() request: VisitorRequest) {
    return this.projects.list(request.visitorId);
  }

  @Post()
  create(@Req() request: VisitorRequest, @Body() input: CreateProjectDto) {
    return this.projects.create(request.visitorId, request.clientIp, input);
  }

  @Get(':id')
  get(@Req() request: VisitorRequest, @Param('id') id: string) {
    return this.projects.get(request.visitorId, id);
  }

  @Patch(':id')
  update(@Req() request: VisitorRequest, @Param('id') id: string, @Body() input: UpdateProjectDto) {
    return this.projects.update(request.visitorId, id, input);
  }

  @Patch(':projectId/scenes/:sceneId')
  updateScene(
    @Req() request: VisitorRequest,
    @Param('projectId') projectId: string,
    @Param('sceneId') sceneId: string,
    @Body() input: UpdateSceneDto,
  ) {
    return this.projects.updateScene(request.visitorId, projectId, sceneId, input);
  }

  @Delete(':id')
  remove(@Req() request: VisitorRequest, @Param('id') id: string) {
    return this.projects.remove(request.visitorId, id);
  }
}
