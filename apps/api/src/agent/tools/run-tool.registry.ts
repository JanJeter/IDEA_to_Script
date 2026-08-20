import type { ZodTypeAny } from 'zod';

export interface RunToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * A registry belongs to exactly one Agent run. The allow-list is immutable and
 * checked while tools are registered, so an accidental global tool cannot leak
 * into a web generation run.
 */
export class RunToolRegistry {
  private readonly tools = new Map<string, RunToolDefinition>();
  private calls = 0;

  constructor(private readonly allowedTools: ReadonlySet<string>) {}

  register(...definitions: RunToolDefinition[]) {
    for (const definition of definitions) {
      if (!this.allowedTools.has(definition.name)) {
        throw new Error(`Tool ${definition.name} is not allowed for this Agent run`);
      }
      if (this.tools.has(definition.name)) {
        throw new Error(`Tool ${definition.name} is already registered`);
      }
      this.tools.set(definition.name, definition);
    }
  }

  names() {
    return [...this.tools.keys()];
  }

  get callCount() {
    return this.calls;
  }

  toAiSdkTools(): Record<string, unknown> {
    return Object.fromEntries(
      [...this.tools.values()].map((definition) => [
        definition.name,
        {
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute: async (input: unknown) => {
            this.calls += 1;
            return definition.execute(input);
          },
        },
      ]),
    );
  }
}

