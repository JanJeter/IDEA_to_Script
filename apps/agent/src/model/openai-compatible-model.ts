import { createOpenAI, type OpenAIProviderSettings } from '@ai-sdk/openai';
import { streamText, type LanguageModel } from 'ai';
import type {
  AgentModelPort,
  AgentModelStepInput,
  AgentModelStepResult,
  AgentToolCall,
} from '../contracts/agent.types';

export interface OpenAICompatibleModelConfig {
  apiKey?: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  thinkingMode?: 'enabled' | 'disabled';
}

type AgentFetch = NonNullable<OpenAIProviderSettings['fetch']>;

export interface OpenAICompatibleModelDependencies {
  fetch?: AgentFetch;
  languageModel?: LanguageModel;
}

function requestUrl(input: Parameters<AgentFetch>[0]) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function withThinkingMode(baseFetch: AgentFetch, thinkingMode?: 'enabled' | 'disabled'): AgentFetch {
  if (!thinkingMode) return baseFetch;
  return async (input, init) => {
    if (
      !requestUrl(input).match(/\/chat\/completions(?:\?|$)/)
      || typeof init?.body !== 'string'
    ) {
      return baseFetch(input, init);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(init.body) as unknown;
    } catch {
      return baseFetch(input, init);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return baseFetch(input, init);
    }
    const headers = new Headers(init.headers);
    headers.delete('content-length');
    return baseFetch(input, {
      ...init,
      headers,
      body: JSON.stringify({
        ...(parsed as Record<string, unknown>),
        thinking: { type: thinkingMode },
      }),
    });
  };
}

function streamError(value: unknown) {
  return value instanceof Error
    ? value
    : new Error('Agent model stream failed', { cause: value });
}

export class OpenAICompatibleAgentModel implements AgentModelPort {
  private readonly languageModel: LanguageModel;

  constructor(
    private readonly config: OpenAICompatibleModelConfig,
    dependencies: OpenAICompatibleModelDependencies = {},
  ) {
    const provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ''),
      fetch: withThinkingMode(
        dependencies.fetch ?? globalThis.fetch as AgentFetch,
        config.thinkingMode,
      ),
    });
    this.languageModel = dependencies.languageModel ?? provider.chat(this.modelId);
  }

  get modelId() {
    return this.config.model;
  }

  get available() {
    return this.config.enabled && Boolean(this.config.apiKey?.trim());
  }

  async executeStep(input: AgentModelStepInput): Promise<AgentModelStepResult> {
    if (!this.available) throw new Error('Agent model is unavailable in demo mode');
    const startedAt = Date.now();
    const toolCalls: AgentToolCall[] = [];
    const result = streamText({
      model: this.languageModel,
      system: input.system,
      messages: input.messages,
      tools: input.tools as never,
      maxRetries: 0,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.signal,
      providerOptions: { openai: { parallelToolCalls: false } },
      onError: () => undefined,
    });
    for await (const part of result.fullStream) {
      if (part.type === 'tool-call') {
        toolCalls.push({ name: part.toolName, input: part.input });
      }
      if (part.type === 'error') throw streamError(part.error);
    }
    const [response, usage, finishReason] = await Promise.all([
      result.response,
      result.usage,
      result.finishReason,
    ]);
    if (finishReason === 'error') throw new Error('Agent model stream finished with an error');
    return {
      messages: response.messages,
      toolCalls,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}
