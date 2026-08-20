export type RetryReason = 'rate_limit' | 'timeout' | 'network' | 'server_error' | 'empty_output';

export interface RetryDecision {
  retry: boolean;
  reason?: RetryReason;
}

function statusFrom(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const direct = Number((error as { status?: unknown }).status);
  if (Number.isInteger(direct)) return direct;
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/(?:status|http)?\s*[:=]?\s*(\d{3})/i);
  return match ? Number(match[1]) : undefined;
}

export class AgentRetryPolicy {
  constructor(
    private readonly baseDelayMs = 500,
    private readonly maxDelayMs = 10_000,
  ) {}

  classify(error: unknown): RetryDecision {
    const status = statusFrom(error);
    if (status === 429 || status === 529) return { retry: true, reason: 'rate_limit' };
    if (status === 408) return { retry: true, reason: 'timeout' };
    if (status !== undefined && status >= 500 && status < 600) {
      return { retry: true, reason: 'server_error' };
    }
    if (status !== undefined && status >= 400 && status < 500) return { retry: false };

    const message = error instanceof Error ? error.message : String(error);
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
