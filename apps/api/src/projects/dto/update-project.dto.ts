import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(
  OmitType(CreateProjectDto, ['mode', 'trendTopicId', 'sourceText'] as const),
) {}
