import type { ModelMessage } from 'ai';

const cjk = /[\u3400-\u9fff\uf900-\ufaff]/;

export function estimateTextTokens(value: string) {
  let cjkChars = 0;
  let otherChars = 0;
  for (const char of value) {
    if (cjk.test(char)) cjkChars += 1;
    else otherChars += 1;
  }
  return Math.ceil((cjkChars + otherChars / 4) * 1.15);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if ('text' in part && typeof part.text === 'string') return part.text;
      if ('input' in part) return JSON.stringify(part.input);
      if ('output' in part) return JSON.stringify(part.output);
      return '';
    })
    .join('');
}

export function estimateMessageTokens(system: string, messages: ModelMessage[], toolTokens = 0) {
  return estimateTextTokens(system)
    + messages.reduce((total, message) => total + estimateTextTokens(contentText(message.content)), 0)
    + toolTokens;
}
