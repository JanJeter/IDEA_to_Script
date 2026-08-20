import type { AgentToolCall } from '../contracts/agent.types';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export class AgentLoopDetector {
  private readonly history: string[] = [];

  record(call: AgentToolCall): { stuck: boolean; reason?: string } {
    const signature = `${call.name}:${stable(call.input)}`;
    this.history.push(signature);
    if (this.history.filter((item) => item === signature).length >= 3) {
      return { stuck: true, reason: `repeated_tool_call:${call.name}` };
    }
    if (this.history.length >= 6) {
      const recent = this.history.slice(-6);
      const pingPong = recent[0] === recent[2]
        && recent[2] === recent[4]
        && recent[1] === recent[3]
        && recent[3] === recent[5];
      if (pingPong) return { stuck: true, reason: 'ping_pong_tool_loop' };
    }
    return { stuck: false };
  }
}
