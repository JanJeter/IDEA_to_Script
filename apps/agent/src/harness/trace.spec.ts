import { redactTraceValue } from './trace';

describe('redactTraceValue', () => {
  it('redacts credentials while preserving token usage telemetry', () => {
    expect(redactTraceValue({
      accessToken: 'secret-value',
      api_key: 'secret-key',
      promptTokens: 120,
      completionTokens: 40,
    })).toEqual({
      accessToken: '[REDACTED]',
      api_key: '[REDACTED]',
      promptTokens: 120,
      completionTokens: 40,
    });
  });
});
