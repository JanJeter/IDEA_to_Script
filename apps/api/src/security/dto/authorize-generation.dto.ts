import { IsObject } from 'class-validator';
import type { AltchaChallenge, AltchaSolution } from '../altcha.types';

export class AuthorizeGenerationDto {
  @IsObject()
  challenge!: AltchaChallenge;

  @IsObject()
  solution!: AltchaSolution;
}
