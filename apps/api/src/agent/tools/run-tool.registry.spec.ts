import { z } from 'zod';
import { RunToolRegistry } from './run-tool.registry';

describe('RunToolRegistry', () => {
  it('rejects a tool outside the immutable run allow-list', () => {
    const registry = new RunToolRegistry(new Set(['read_project_seed']));

    expect(() =>
      registry.register({
        name: 'bash',
        description: 'must never be available',
        inputSchema: z.object({ command: z.string() }),
        execute: async () => 'no',
      }),
    ).toThrow('not allowed');
  });

  it('exposes only registered allowed tools and counts executions', async () => {
    const registry = new RunToolRegistry(new Set(['submit_stage_draft']));
    registry.register({
      name: 'submit_stage_draft',
      description: 'submit',
      inputSchema: z.object({ value: z.string() }),
      execute: async (input) => input,
    });

    const tools = registry.toAiSdkTools() as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >;
    await expect(tools.submit_stage_draft.execute({ value: 'ok' })).resolves.toEqual({ value: 'ok' });
    expect(registry.names()).toEqual(['submit_stage_draft']);
    expect(registry.callCount).toBe(1);
  });
});

