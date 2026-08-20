import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
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
}

export class OpenAICompatibleAgentModel implements AgentModelPort {
  private readonly provider;

  constructor(private readonly config: OpenAICompatibleModelConfig) {
    this.provider = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ''),
    });
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
      model: this.provider.chat(this.modelId),
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
    }
    const [response, usage] = await Promise.all([result.response, result.usage]);
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
