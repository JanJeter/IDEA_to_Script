import type { ZodTypeAny } from 'zod';
import { AgentExecutionError, ToolInputValidationError } from '../harness/errors';

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
  readOnly?: boolean;
  timeoutMs?: number;
  maxResultChars?: number;
}

export interface AgentToolHook {
  before?(name: string, input: unknown): void | Promise<void>;
  after?(name: string, input: unknown, output: unknown): void | Promise<void>;
}

function limitedResult(value: unknown, maxChars: number) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  return {
    truncated: true,
    originalChars: serialized.length,
    output: `${serialized.slice(0, head)}\n...[tool result truncated]...\n${serialized.slice(-tail)}`,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Agent tool ${toolName} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();
  private readonly allowedTools: ReadonlySet<string>;
  private calls = 0;
  private mutatingCalls = 0;

  constructor(
    allowedTools: ReadonlySet<string>,
    private readonly maxCalls: number,
    private readonly hook?: AgentToolHook,
  ) {
    if (!Number.isInteger(maxCalls) || maxCalls < 1) {
      throw new Error('Agent tool maxCalls must be a positive integer');
    }
    this.allowedTools = new Set(allowedTools);
  }

  register(...definitions: AgentToolDefinition[]) {
    for (const definition of definitions) {
      if (!this.allowedTools.has(definition.name)) {
        throw new Error(`Tool ${definition.name} is not allowed for this Agent run`);
      }
      if (this.tools.has(definition.name)) {
        throw new Error(`Tool ${definition.name} is already registered`);
      }
      this.tools.set(definition.name, definition);
    }
    return this;
  }

  names() {
    return [...this.tools.keys()];
  }

  get callCount() {
    return this.calls;
  }

  get mutatingCallCount() {
    return this.mutatingCalls;
  }

  get hasMutatingTools() {
    return [...this.tools.values()].some((tool) => !tool.readOnly);
  }

  get schemaTokenEstimate() {
    const chars = [...this.tools.values()].reduce(
      (total, tool) => total + tool.name.length + tool.description.length + 300,
      0,
    );
    return Math.ceil(chars / 4);
  }

  toAiSdkTools(): Record<string, any> {
    return Object.fromEntries(
      [...this.tools.values()].map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: async (input: unknown) => {
            if (this.calls >= this.maxCalls) {
              throw new AgentExecutionError('Agent tool-call budget exhausted', 'tool_limit');
            }
            const parsed = definition.inputSchema.safeParse(input);
            if (!parsed.success) {
              throw new ToolInputValidationError(definition.name, parsed.error.issues);
            }
            this.calls += 1;
            if (!definition.readOnly) this.mutatingCalls += 1;
            await this.hook?.before?.(definition.name, parsed.data);
            const output = await withTimeout(
              definition.execute(parsed.data),
              definition.timeoutMs ?? 15_000,
              definition.name,
            );
            const limited = limitedResult(output, definition.maxResultChars ?? 4_000);
            await this.hook?.after?.(definition.name, parsed.data, limited);
            return limited;
          },
        },
      ]),
    );
  }
}
