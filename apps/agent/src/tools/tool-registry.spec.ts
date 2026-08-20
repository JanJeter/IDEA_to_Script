import { z } from 'zod';
import { AgentToolRegistry } from './tool-registry';

describe('AgentToolRegistry', () => {
  it('rejects tools outside the immutable capability allow-list', () => {
    const allowed = new Set(['read_project_seed']);
    const registry = new AgentToolRegistry(allowed, 3);
    allowed.add('bash');
    expect(() => registry.register({
      name: 'bash',
      description: 'must never be available',
      inputSchema: z.object({ command: z.string() }),
      execute: async () => 'no',
    })).toThrow('not allowed');
  });

  it('validates inputs and enforces the run-level tool budget', async () => {
    const registry = new AgentToolRegistry(new Set(['submit']), 1);
    registry.register({
      name: 'submit',
      description: 'submit',
      inputSchema: z.object({ value: z.string() }).strict(),
      execute: async (input) => input,
    });
    const tools = registry.toAiSdkTools();
    await expect(tools.submit.execute({ value: 'ok' })).resolves.toEqual({ value: 'ok' });
    await expect(tools.submit.execute({ value: 'again' })).rejects.toMatchObject({
      reason: 'tool_limit',
    });
    expect(registry.callCount).toBe(1);
  });
});
