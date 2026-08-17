import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function nonJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token');
    },
  } as unknown as Response;
}

function liveService(overrides: Record<string, string> = {}) {
  return new LlmService(
    new ConfigService({
      DEMO_MODE: 'false',
      LLM_API_KEY: 'test-key',
      ...overrides,
    }),
  );
}

describe('LlmService', () => {
  afterEach(() => jest.restoreAllMocks());

  const service = new LlmService(new ConfigService({ DEMO_MODE: 'true' }));

  it('extracts JSON from a fenced model response', () => {
    expect(service.parseJson<{ ok: boolean }>('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it('uses fallback data in demo mode without recording an upstream call', async () => {
    const onCall = jest.fn();
    const result = await service.generateJson(
      { system: 'test', user: 'test' },
      () => ({ value: 17 }),
      { onCall },
    );
    expect(result).toEqual({ value: 17 });
    expect(onCall).not.toHaveBeenCalled();
  });

  it('keeps an uppercase TRUE value in demo mode even when an API key exists', () => {
    const uppercase = new LlmService(
      new ConfigService({ DEMO_MODE: ' TRUE ', LLM_API_KEY: 'would-enable-live-with-old-logic' }),
    );

    expect(uppercase.isDemo).toBe(true);
  });

  it.each(['ture', '1', 'yes'])('rejects invalid production DEMO_MODE=%s', (mode) => {
    expect(
      () =>
        new LlmService(
          new ConfigService({
            NODE_ENV: 'production',
            DEMO_MODE: mode,
            LLM_API_KEY: 'test-key',
          }),
        ),
    ).toThrow('DEMO_MODE must be exactly true or false in production');
  });

  it('rejects paid production mode without an API key', () => {
    expect(
      () =>
        new LlmService(
          new ConfigService({ NODE_ENV: 'production', DEMO_MODE: 'false', LLM_API_KEY: '' }),
        ),
    ).toThrow('LLM_API_KEY is required when DEMO_MODE=false in production');
  });

  it('records provider usage and sends a capped output token limit', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, {
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 123, completion_tokens: 45 },
      }),
    );
    const onCall = jest.fn();
    const live = liveService({
      LLM_MAX_OUTPUT_TOKENS: '999999',
      LLM_THINKING_MODE: 'disabled',
    });

    await expect(
      live.generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).resolves.toEqual({ ok: true });
    const body = JSON.parse(String(request.mock.calls[0][1]?.body)) as {
      max_tokens: number;
      thinking: { type: string };
    };
    expect(body.max_tokens).toBe(8192);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(onCall).toHaveBeenCalledWith({
      sequence: 1,
      structured: true,
      outcome: 'success',
      retryable: false,
      httpStatus: 200,
      promptTokens: 123,
      completionTokens: 45,
      durationMs: expect.any(Number),
    });
  });

  it('keeps token counts null when a successful provider response omits usage', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, { choices: [{ message: { content: '{"ok":true}' } }] }),
    );
    const onCall = jest.fn();

    await liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall });

    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ promptTokens: null, completionTokens: null, outcome: 'success' }),
    );
  });

  it('falls back once only when the provider explicitly rejects response_format', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(400, { error: { message: 'response_format json_object is not supported' } }),
      )
      .mockResolvedValueOnce(
        response(200, {
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      );
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).resolves.toEqual({ ok: true });

    expect(request).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(request.mock.calls[0][1]?.body)) as Record<string, unknown>;
    const secondBody = JSON.parse(String(request.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(firstBody).toHaveProperty('response_format');
    expect(secondBody).not.toHaveProperty('response_format');
    expect(onCall.mock.calls.map(([call]) => call)).toEqual([
      expect.objectContaining({
        sequence: 1,
        structured: true,
        outcome: 'unsupported_response_format',
      }),
      expect.objectContaining({ sequence: 2, structured: false, outcome: 'success' }),
    ]);
  });

  it('remembers an explicit response_format rejection for later job attempts', async () => {
    const request = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        response(400, { error: { message: 'response_format json_object is not supported' } }),
      )
      .mockResolvedValue(
        response(200, { choices: [{ message: { content: '{"ok":true}' } }] }),
      );
    const live = liveService();

    await live.generateJson({ system: 'first', user: 'first' }, () => ({}));
    await live.generateJson({ system: 'second', user: 'second' }, () => ({}));

    expect(request).toHaveBeenCalledTimes(3);
    const laterAttempt = JSON.parse(String(request.mock.calls[2][1]?.body)) as Record<string, unknown>;
    expect(laterAttempt).not.toHaveProperty('response_format');
  });

  it.each([
    [401, 'authentication'],
    [408, 'timeout'],
    [429, 'rate_limit'],
    [503, 'provider_unavailable'],
    [400, 'client_error'],
  ])('does not perform an indiscriminate model-layer retry for HTTP %i', async (status, kind) => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(status, { error: { message: 'request rejected' } }),
    );
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).rejects.toMatchObject({ kind, retryable: false });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ sequence: 1, outcome: kind }));
  });

  it('preserves the HTTP failure class when a gateway returns a non-JSON error page', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(nonJsonResponse(503));
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).rejects.toMatchObject({ kind: 'provider_unavailable', retryable: false, httpStatus: 503 });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'provider_unavailable', httpStatus: 503 }),
    );
  });

  it('does not retry an empty or malformed model response and preserves reported usage', async () => {
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      response(200, {
        choices: [{ message: { content: 'not-json' } }],
        usage: { prompt_tokens: 31, completion_tokens: 9 },
      }),
    );
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).rejects.toMatchObject({ kind: 'invalid_response' });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'invalid_response',
        promptTokens: 31,
        completionTokens: 9,
      }),
    );
  });

  it('records transport failures without issuing a second upstream call', async () => {
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('connection reset'));
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).rejects.toMatchObject({ kind: 'transport', retryable: false });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'transport', retryable: false, httpStatus: null }),
    );
  });

  it.each(['TimeoutError', 'AbortError'])('treats local %s as an unknown paid outcome', async (name) => {
    const timeout = new Error('request timed out');
    timeout.name = name;
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(timeout);
    const onCall = jest.fn();

    await expect(
      liveService().generateJson({ system: 'test', user: 'test' }, () => ({}), { onCall }),
    ).rejects.toMatchObject({ kind: 'timeout', retryable: false });

    expect(request).toHaveBeenCalledTimes(1);
    expect(onCall).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'timeout', retryable: false, httpStatus: null }),
    );
  });
});
