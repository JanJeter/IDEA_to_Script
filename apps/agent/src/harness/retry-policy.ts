export type RetryReason =
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'server_error'
  | 'empty_output'
  | 'provider_retryable';

export interface RetryDecision {
  retry: boolean;
  reason?: RetryReason;
}

type ErrorShape = {
  status?: unknown;
  statusCode?: unknown;
  isRetryable?: unknown;
  cause?: unknown;
};

function errorChain(error: unknown) {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current = (current as ErrorShape).cause;
  }
  return chain;
}

function statusFrom(error: unknown): number | undefined {
  for (const candidate of errorChain(error)) {
    const shape = candidate as ErrorShape;
    for (const value of [shape.statusCode, shape.status]) {
      if (value === undefined || value === null || value === '') continue;
      const status = Number(value);
      if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
    }
  }
  const message = errorMessages(error);
  const match = message.match(
    /\b(?:http(?:\s+status)?|status(?:\s+code)?)\s*[:=#-]?\s*(\d{3})\b/i,
  );
  return match ? Number(match[1]) : undefined;
}

function retryableHint(error: unknown): boolean | undefined {
  for (const candidate of errorChain(error)) {
    const hint = (candidate as ErrorShape).isRetryable;
    if (typeof hint === 'boolean') return hint;
  }
  return undefined;
}

function errorMessages(error: unknown) {
  const messages = errorChain(error)
    .map((candidate) => candidate instanceof Error ? candidate.message : String(candidate))
    .filter(Boolean);
  return messages.length ? messages.join(' | ') : String(error);
}

export class AgentRetryPolicy {
  constructor(
    private readonly baseDelayMs = 500,
    private readonly maxDelayMs = 10_000,
  ) {}

  classify(error: unknown): RetryDecision {
    const status = statusFrom(error);
    const hint = retryableHint(error);
    if (hint === false) return { retry: false };

    if (status === 429 || status === 529) return { retry: true, reason: 'rate_limit' };
    if (status === 408) return { retry: true, reason: 'timeout' };
    if (status !== undefined && status >= 500 && status < 600) {
      return { retry: true, reason: 'server_error' };
    }
    if (hint === true) return { retry: true, reason: 'provider_retryable' };
    if (status !== undefined && status >= 400 && status < 500) return { retry: false };

    const message = errorMessages(error);
    if (/ECONNRESET|EPIPE|fetch failed|network/i.test(message)) {
      return { retry: true, reason: 'network' };
    }
    if (/ETIMEDOUT|timeout|aborted/i.test(message)) return { retry: true, reason: 'timeout' };
    if (/No output generated|empty output/i.test(message)) {
      return { retry: true, reason: 'empty_output' };
    }
    return { retry: false };
  }

  delayMs(attempt: number) {
    const capped = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.max(0, attempt - 1));
    const jitter = capped * 0.25;
    return Math.max(0, Math.round(capped - jitter + Math.random() * jitter * 2));
  }
}

export function abortableDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('Agent run aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Agent run aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
