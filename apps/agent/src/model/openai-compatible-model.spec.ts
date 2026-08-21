import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { OpenAICompatibleAgentModel } from './openai-compatible-model';

const input = {
  system: 'system',
  messages: [{ role: 'user' as const, content: 'test' }],
  maxOutputTokens: 128,
  signal: new AbortController().signal,
};

describe('OpenAICompatibleAgentModel', () => {
  it('rejects an AI SDK stream error even after a submission tool executed', async () => {
    let submitted = false;
    const languageModel = {
      specificationVersion: 'v2',
      provider: 'test',
      modelId: 'stream-error',
      supportedUrls: {},
      doGenerate: async () => { throw new Error('unused'); },
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({
              type: 'tool-call',
              toolCallId: 'call-1',
              toolName: 'submit',
              input: '{}',
            });
            controller.enqueue({ type: 'error', error: new Error('provider stream failed') });
            controller.close();
          },
        }),
      }),
    } as LanguageModel;
    const model = new OpenAICompatibleAgentModel(
      {
        apiKey: 'test',
        baseUrl: 'https://provider.invalid/v1',
        model: 'test-model',
        enabled: true,
      },
      { languageModel },
    );

    await expect(model.executeStep({
      ...input,
      tools: {
        submit: {
          description: 'submit',
          inputSchema: z.object({}).strict(),
          execute: async () => {
            submitted = true;
            return { accepted: true };
          },
        },
      },
    })).rejects.toThrow('provider stream failed');
    expect(submitted).toBe(true);
  });

  it('adds an explicitly configured thinking mode to chat-completion requests', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = jest.fn(async (_input: unknown, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      throw new Error('stop after request capture');
    });
    const model = new OpenAICompatibleAgentModel(
      {
        apiKey: 'test',
        baseUrl: 'https://provider.invalid/v1',
        model: 'test-model',
        enabled: true,
        thinkingMode: 'disabled',
      },
      { fetch: fetchMock as never },
    );

    await expect(model.executeStep({ ...input, tools: {} })).rejects.toThrow();
    expect(requestBody).toEqual(expect.objectContaining({
      thinking: { type: 'disabled' },
    }));
  });
});
