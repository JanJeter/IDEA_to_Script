import type { AgentTraceEvent, AgentTraceSink } from '../contracts/agent.types';

// A singular `...token` key is credential-like. Plural usage counters such as
// promptTokens and completionTokens are safe operational metadata.
const sensitiveKey = /api[-_]?key|authorization|cookie|password|secret|token$/i;

export function redactTraceValue(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactTraceValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactTraceValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export class InMemoryAgentTraceSink implements AgentTraceSink {
  readonly events: AgentTraceEvent[] = [];

  record(event: AgentTraceEvent) {
    this.events.push(redactTraceValue(event) as AgentTraceEvent);
  }
}
