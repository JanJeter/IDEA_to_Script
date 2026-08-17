import type { ConfigService } from '@nestjs/config';

export type GenerationMode = 'demo' | 'llm';

/**
 * Cost-sensitive mode switch. Only an explicit, normalized `false` plus a
 * non-empty API key can enable paid generation.
 */
export function resolveGenerationMode(config: ConfigService): GenerationMode {
  const configured = String(config.get<string>('DEMO_MODE', 'true')).trim().toLowerCase();
  const production = config.get<string>('NODE_ENV') === 'production';
  if (configured !== 'true' && configured !== 'false') {
    if (production) throw new Error('DEMO_MODE must be exactly true or false in production');
    return 'demo';
  }
  if (configured !== 'false') return 'demo';

  const apiKey = (config.get<string>('LLM_API_KEY', '') ?? '').trim();
  if (!apiKey) {
    if (production) throw new Error('LLM_API_KEY is required when DEMO_MODE=false in production');
    return 'demo';
  }
  return 'llm';
}
