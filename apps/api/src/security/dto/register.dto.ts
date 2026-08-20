import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const USERNAME_PATTERN = /^[\p{Script=Han}A-Za-z0-9._-]+$/u;

export class RegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().normalize('NFKC') : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(USERNAME_PATTERN, { message: '用户名只能包含中英文、数字、点、下划线和短横线' })
  username!: string;

  @IsString()
  @MinLength(15)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(15)
  @MaxLength(128)
  passwordConfirmation!: string;
}
