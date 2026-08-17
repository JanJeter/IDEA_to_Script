import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText, type ModelMessage } from 'ai';
import { resolveGenerationMode, type GenerationMode } from '../../generation/generation-mode';
import type {
  AgentModelStepResult,
  AgentToolCall,
} from '../contracts/stage-agent.types';

@Injectable()
export class AgentModelService {
  private readonly generationMode: GenerationMode;

  constructor(private readonly config: ConfigService) {
    this.generationMode = resolveGenerationMode(config);
  }

  get model() {
    return this.config.get<string>('LLM_MODEL', 'gpt-4.1-mini');
  }

  get available() {
    return this.generationMode === 'llm';
  }

  async executeStep(input: {
    system: string;
    messages: ModelMessage[];
    tools: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<AgentModelStepResult> {
    if (!this.available) throw new Error('Agent model is unavailable in demo mode');

    const provider = createOpenAI({
      apiKey: this.config.get<string>('LLM_API_KEY'),
      baseURL: this.config
        .get<string>('LLM_BASE_URL', 'https://api.openai.com/v1')
        .replace(/\/$/, ''),
    });
    const toolCalls: AgentToolCall[] = [];
    const result = streamText({
      model: provider.chat(this.model),
      system: input.system,
      messages: input.messages,
      tools: input.tools as never,
      maxRetries: 0,
      maxOutputTokens: this.maxOutputTokens,
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
      },
    };
  }

  private get maxOutputTokens() {
    const value = Number(this.config.get<string>('LLM_MAX_OUTPUT_TOKENS', '4096'));
    if (!Number.isInteger(value) || value < 256) return 4_096;
    return Math.min(value, 8_192);
  }
}
