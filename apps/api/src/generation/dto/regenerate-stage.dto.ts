import { IsString, Length } from 'class-validator';

export class RegenerateStageDto {
  @IsString()
  @Length(43, 43)
  ticket: string;
}
