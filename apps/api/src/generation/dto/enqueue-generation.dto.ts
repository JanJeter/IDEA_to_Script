import { IsString, Length } from 'class-validator';

export class EnqueueGenerationDto {
  @IsString()
  @Length(43, 43)
  ticket: string;
}
