import { IsArray, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class DialogueLineDto {
  @IsString()
  @Length(1, 80)
  character!: string;

  @IsOptional()
  @IsString()
  parenthetical?: string;

  @IsString()
  text!: string;
}

export class UpdateSceneDto {
  @IsOptional()
  @IsString()
  heading?: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DialogueLineDto)
  dialogue?: DialogueLineDto[];
}
