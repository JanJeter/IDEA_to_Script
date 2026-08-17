import { Type } from 'class-transformer';
import { ProjectMode } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProjectDto {
  @IsOptional()
  @IsEnum(ProjectMode)
  mode?: ProjectMode;

  @ValidateIf((input: CreateProjectDto) =>
    input.mode === ProjectMode.TREND_INSPIRED || input.trendTopicId !== undefined)
  @IsString()
  @Length(1, 80)
  trendTopicId?: string;

  @IsString()
  @Length(1, 80)
  title!: string;

  @IsString()
  @Length(10, 1000)
  logline!: string;

  @IsOptional()
  @IsString()
  @Length(10, 10000)
  sourceText?: string;

  @IsString()
  @Length(1, 40)
  genre!: string;

  @IsString()
  @Length(1, 80)
  tone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 12)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(30)
  targetMinutes?: number;
}
