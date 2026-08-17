import { IsObject } from 'class-validator';

export class UpdateStageDto {
  @IsObject()
  content!: Record<string, unknown>;
}
