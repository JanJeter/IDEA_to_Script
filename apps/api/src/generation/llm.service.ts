import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolveGenerationMode, type GenerationMode } from './generation-mode';

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
};

export type LlmFailureKind =
  | 'authentication'
  | 'rate_limit'
  | 'provider_unavailable'
  | 'unsupported_response_format'
  | 'client_error'
  | 'timeout'
  | 'transport'
  | 'invalid_response';

export type LlmCallTelemetry = {
  sequence: number;
  structured: boolean;
  outcome: 'success' | LlmFailureKind;
  retryable: boolean;
  httpStatus: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  durationMs: number;
};

export type LlmCallObserver = (telemetry: LlmCallTelemetry) => void;

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly kind: LlmFailureKind,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LlmRequestError';
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly generationMode: GenerationMode;
  private structuredOutputSupported: boolean | undefined;

  constructor(private readonly config: ConfigService) {
    this.generationMode = resolveGenerationMode(config);
  }

  get model() {
    return this.isDemo ? 'built-in-demo-writer' : this.config.get('LLM_MODEL', 'gpt-4.1-mini');
  }

  get isDemo() {
    return this.generationMode === 'demo';
  }

  async generateJson<T>(
    prompt: { system: string; user: string },
    fallback: () => T,
    options: { onCall?: LlmCallObserver } = {},
  ): Promise<T> {
    if (this.isDemo) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return fallback();
    }

    try {
      return await this.request<T>(prompt, this.structuredOutputSupported !== false, 1, options.onCall);
    } catch (error) {
      if (!(error instanceof LlmRequestError) || error.kind !== 'unsupported_response_format') {
        throw error;
      }
      this.structuredOutputSupported = false;
      this.logger.warn('Provider rejected response_format; retrying once without structured-output mode');
      return this.request<T>(prompt, false, 2, options.onCall);
    }
  }

  private async request<T>(
    prompt: { system: string; user: string },
    structured: boolean,
    sequence: number,
    onCall?: LlmCallObserver,
  ): Promise<T> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, '');
    const timeout = this.timeoutMs;
    const body: Record<string, unknown> = {
      model: this.config.get('LLM_MODEL', 'gpt-4.1-mini'),
      temperature: 0.75,
      max_tokens: this.maxOutputTokens,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };
    // Providers such as DeepSeek V4 can default to reasoning; LLM_THINKING_MODE can opt JSON workflows out.
    const thinkingMode = this.config.get<string>('LLM_THINKING_MODE', '').trim().toLowerCase();
    if (thinkingMode === 'enabled' || thinkingMode === 'disabled') {
      body.thinking = { type: thinkingMode };
    }
    if (structured) body.response_format = { type: 'json_object' };

    const startedAt = Date.now();
    let httpStatus: number | null = null;
    let promptTokens: number | null = null;
    let completionTokens: number | null = null;
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.get<string>('LLM_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      httpStatus = response.status;
      const payload = await this.readPayload(response, structured);
      ({ promptTokens, completionTokens } = this.usage(payload));
      if (!response.ok) throw this.httpError(response.status, payload.error?.message, structured);

      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new LlmRequestError('LLM returned an empty response', 'invalid_response', false, response.status);
      }
      let parsed: T;
      try {
        parsed = this.parseJson<T>(content);
      } catch (error) {
        throw new LlmRequestError('LLM returned invalid JSON', 'invalid_response', false, response.status, {
          cause: error,
        });
      }
      onCall?.({
        sequence,
        structured,
        outcome: 'success',
        retryable: false,
        httpStatus,
        promptTokens,
        completionTokens,
        durationMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      const failure = this.normalizeError(error, httpStatus);
      onCall?.({
        sequence,
        structured,
        outcome: failure.kind,
        retryable: failure.retryable,
        httpStatus: failure.httpStatus,
        promptTokens,
        completionTokens,
        durationMs: Date.now() - startedAt,
      });
      throw failure;
    }
  }

  private async readPayload(response: Response, structured: boolean): Promise<ChatResponse> {
    try {
      const maxBytes = 2 * 1024 * 1024;
      const contentLength = Number(response.headers?.get('content-length') ?? 0);
      if (contentLength > maxBytes) throw new LlmRequestError('LLM response is too large', 'invalid_response', false, response.status);
      const reader = response.body?.getReader();
      if (!reader) return (await response.json()) as ChatResponse;
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new LlmRequestError('LLM response is too large', 'invalid_response', false, response.status); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder().decode(bytes)) as ChatResponse;
    } catch (error) {
      // Gateways commonly return HTML/plain text for 4xx/5xx responses. Preserve the
      // HTTP failure class instead of misreporting those responses as malformed model JSON.
      if (!response.ok) throw this.httpError(response.status, undefined, structured);
      throw new LlmRequestError(
        'LLM returned a non-JSON HTTP response',
        'invalid_response',
        false,
        response.status,
        { cause: error },
      );
    }
  }

  private httpError(status: number, providerMessage: string | undefined, structured: boolean) {
    // This provider interface has no cross-vendor idempotency guarantee. Once a
    // request has left the process, 408/429/5xx and connection loss can be an
    // unknown paid outcome, so the worker must require an explicit user retry.
    if (status === 401 || status === 403) {
      return new LlmRequestError('LLM authentication failed', 'authentication', false, status);
    }
    if (status === 429) {
      return new LlmRequestError('LLM rate limit exceeded', 'rate_limit', false, status);
    }
    if (status === 408) {
      return new LlmRequestError('LLM request timed out', 'timeout', false, status);
    }
    if (status >= 500) {
      return new LlmRequestError('LLM provider is unavailable', 'provider_unavailable', false, status);
    }
    if (structured && (status === 400 || status === 422) && this.rejectsResponseFormat(providerMessage)) {
      return new LlmRequestError(
        'LLM provider does not support response_format',
        'unsupported_response_format',
        false,
        status,
      );
    }
    return new LlmRequestError(`LLM request rejected with HTTP ${status}`, 'client_error', false, status);
  }

  private rejectsResponseFormat(message: string | undefined) {
    if (!message) return false;
    const normalized = message.toLowerCase();
    const namesFormat = normalized.includes('response_format') || normalized.includes('json_object');
    const rejects =
      normalized.includes('unsupported') ||
      normalized.includes('not support') ||
      normalized.includes('unknown') ||
      normalized.includes('invalid');
    return namesFormat && rejects;
  }

  private normalizeError(error: unknown, httpStatus: number | null) {
    if (error instanceof LlmRequestError) return error;
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return new LlmRequestError('LLM request timed out', 'timeout', false, httpStatus, { cause: error });
    }
    return new LlmRequestError('LLM transport failed', 'transport', false, httpStatus, {
      cause: error instanceof Error ? error : undefined,
    });
  }

  private usage(payload: ChatResponse) {
    return {
      promptTokens: this.tokenCount(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens),
      completionTokens: this.tokenCount(
        payload.usage?.completion_tokens ?? payload.usage?.output_tokens,
      ),
    };
  }

  private tokenCount(value: unknown) {
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) return null;
    return Math.min(2_147_483_647, Math.round(count));
  }

  private get timeoutMs() {
    const configured = Number(this.config.get<string>('LLM_TIMEOUT_MS', '90000'));
    if (!Number.isInteger(configured) || configured < 1_000) return 90_000;
    return Math.min(configured, 300_000);
  }

  private get maxOutputTokens() {
    const configured = Number(this.config.get<string>('LLM_MAX_OUTPUT_TOKENS', '4096'));
    if (!Number.isInteger(configured) || configured < 256) return 4096;
    return Math.min(configured, 8192);
  }

  parseJson<T>(content: string): T {
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No JSON object found in model response');
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  }
}
