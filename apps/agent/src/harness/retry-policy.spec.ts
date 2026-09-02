import { APICallError } from '@ai-sdk/provider';
import { AgentRetryPolicy } from './retry-policy';

describe('AgentRetryPolicy', () => {
  const policy = new AgentRetryPolicy(0, 0);

  it('uses the AI SDK statusCode and retryable hint', () => {
    const error = new APICallError({
      message: 'Rate limit reached',
      url: 'https://provider.invalid/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: {},
      responseBody: '',
      isRetryable: true,
    });

    expect(policy.classify(error)).toEqual({ retry: true, reason: 'rate_limit' });
  });

  it('honors an AI SDK retryable hint for a conflict response', () => {
    const error = new APICallError({
      message: 'Conflict while processing the request',
      url: 'https://provider.invalid/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 409,
      responseHeaders: {},
      responseBody: '',
    });

    expect(policy.classify(error)).toEqual({
      retry: true,
      reason: 'provider_retryable',
    });
  });

  it('honors an explicit non-retryable provider hint', () => {
    const error = new APICallError({
      message: 'Provider rejected retrying this failure',
      url: 'https://provider.invalid/v1/chat/completions',
      requestBodyValues: {},
      statusCode: 503,
      responseHeaders: {},
      responseBody: '',
      isRetryable: false,
    });

    expect(policy.classify(error)).toEqual({ retry: false });
  });

  it('does not mistake arbitrary three-digit numbers for HTTP status codes', () => {
    expect(policy.classify(new Error('timeout after 400 ms'))).toEqual({
      retry: true,
      reason: 'timeout',
    });
  });

  it('honors a nested provider retryable hint', () => {
    expect(policy.classify(new Error('request failed', {
      cause: { isRetryable: true },
    }))).toEqual({ retry: true, reason: 'provider_retryable' });
  });
});
