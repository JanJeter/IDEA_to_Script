import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFKC') : value,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
