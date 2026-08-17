import { IsString, MaxLength, MinLength } from 'class-validator';

export class AuthorizeAccessDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  code!: string;
}
