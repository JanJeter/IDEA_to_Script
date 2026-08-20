import type { ModelMessage } from 'ai';

export function compactOldToolResults(messages: ModelMessage[], keepRecent = 3): ModelMessage[] {
  const toolIndices = messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'tool')
    .map(({ index }) => index);
  const replace = new Set(toolIndices.slice(0, Math.max(0, toolIndices.length - keepRecent)));
  return messages.map((message, index) => {
    if (!replace.has(index) || !Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) => ({
        ...part,
        output: { type: 'text', value: '[older tool result compacted]' },
      })),
    } as ModelMessage;
  });
}
