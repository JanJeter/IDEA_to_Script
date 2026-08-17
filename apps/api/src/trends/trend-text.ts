import { isIP } from 'node:net';

const zeroWidthCharacters = /[\u200B-\u200D\u2060\uFEFF]/g;
const htmlTags = /<[^>]*>/g;

export function sanitizePlainText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(htmlTags, ' ')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return !((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
    })
    .join('')
    .replace(zeroWidthCharacters, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function safeHttpUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safePublicSourceUrl(value: unknown) {
  const parsed = safeHttpUrl(value);
  if (!parsed) return null;
  const url = new URL(parsed);
  if (url.protocol !== 'https:') return null;
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLocaleLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return null;
  }
  if (isIP(hostname) && isPrivateOrReservedAddress(hostname)) return null;
  return url.toString();
}

export function isPrivateOrReservedAddress(value: string) {
  const address = value.toLocaleLowerCase();
  if (address.includes(':')) {
    if (address.startsWith('::ffff:')) {
      const mapped = address.slice('::ffff:'.length);
      if (mapped.includes('.')) return isPrivateOrReservedAddress(mapped);
      const words = mapped.split(':').map((word) => Number.parseInt(word, 16));
      if (words.length === 2 && words.every((word) => Number.isInteger(word))) {
        return isPrivateOrReservedAddress(
          `${words[0] >> 8}.${words[0] & 255}.${words[1] >> 8}.${words[1] & 255}`,
        );
      }
      return true;
    }
    return (
      address === '::' ||
      address === '::1' ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      /^fe[89abcdef]/.test(address) ||
      address.startsWith('ff') ||
      address.startsWith('2001:db8:')
    );
  }
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

export function finiteInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(2_147_483_647, Math.round(parsed));
}

export function safeDate(value: unknown) {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function fetchJson(
  url: string,
  options: {
    timeoutMs: number;
    userAgent: string;
    attempts?: number;
    redirect?: RequestRedirect;
    headers?: Record<string, string>;
    maxBytes?: number;
  },
) {
  const attempts = Math.max(1, options.attempts ?? 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': options.userAgent,
          ...options.headers,
        },
        redirect: options.redirect ?? 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      if (!response.ok) {
        const requestError = new Error(`HTTP ${response.status} from ${new URL(url).hostname}`) as Error & {
          retryable?: boolean;
          retryAfterMs?: number;
        };
        requestError.retryable = response.status === 429 || response.status >= 500;
        if (response.status === 429) {
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after')) ?? 0;
          const rateLimitResetMs = parseRateLimitReset(response.headers.get('x-rate-limit-reset')) ?? 0;
          requestError.retryAfterMs = Math.max(retryAfterMs, rateLimitResetMs) || undefined;
        }
        throw requestError;
      }
      return await readJsonWithLimit(response, options.maxBytes ?? 2 * 1024 * 1024);
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof Error) || (error as Error & { retryable?: boolean }).retryable !== false;
      if (attempt + 1 < attempts && retryable) {
        const requestedDelay = error instanceof Error
          ? (error as Error & { retryAfterMs?: number }).retryAfterMs
          : undefined;
        const delayMs = Math.min(30_000, Math.max(250 * 2 ** attempt, requestedDelay ?? 0));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else if (!retryable) {
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Trend source request failed');
}

function parseRateLimitReset(value: string | null) {
  if (!value) return undefined;
  const epochSeconds = Number(value);
  if (!Number.isFinite(epochSeconds) || epochSeconds < 0) return undefined;
  return Math.max(0, Math.round(epochSeconds * 1000 - Date.now()));
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Math.max(0, date.getTime() - Date.now());
}

async function readJsonWithLimit(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Trend source response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`Trend source response exceeds ${maxBytes} bytes`);
    }
    return JSON.parse(text) as unknown;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error(`Trend source response exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk.value);
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(combined)) as unknown;
}
