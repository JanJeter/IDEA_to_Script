import { z } from 'zod';
import type { AgentToolDefinition } from '../tools/tool-registry';
import { estimateTextTokens } from './token-estimator';

export interface SourceChunk {
  id: string;
  index: number;
  text: string;
  estimatedTokens: number;
}

function terms(value: string) {
  const normalized = value.toLocaleLowerCase();
  const latin = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const chinese = [...normalized.matchAll(/[\u3400-\u9fff]{2,}/g)]
    .flatMap((match) => {
      const text = match[0];
      return [...Array(Math.max(0, text.length - 1))].map((_, index) => text.slice(index, index + 2));
    });
  return [...new Set([...latin, ...chinese])];
}

export class SourceDocument {
  readonly chunks: SourceChunk[];

  constructor(
    readonly text: string,
    targetTokens = 1_000,
    overlapTokens = 100,
  ) {
    this.chunks = this.chunk(text, targetTokens, overlapTokens);
  }

  get estimatedTokens() {
    return estimateTextTokens(this.text);
  }

  read(chunkId: string) {
    return this.chunks.find((chunk) => chunk.id === chunkId) ?? null;
  }

  search(query: string, limit = 4) {
    const queryTerms = terms(query);
    return this.chunks
      .map((chunk) => ({
        chunk,
        score: queryTerms.reduce(
          (score, term) => score + (chunk.text.toLocaleLowerCase().includes(term) ? 1 : 0),
          0,
        ),
      }))
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score || left.chunk.index - right.chunk.index)
      .slice(0, Math.max(1, Math.min(limit, 8)))
      .map(({ chunk, score }) => ({
        id: chunk.id,
        score,
        preview: chunk.text.slice(0, 240),
      }));
  }

  indexText() {
    return this.chunks
      .map((chunk) => `${chunk.id}: ${chunk.text.slice(0, 120).replace(/\s+/g, ' ')}`)
      .join('\n');
  }

  tools(): AgentToolDefinition[] {
    return [
      {
        name: 'search_source',
        description: 'Search the adaptation source and return matching chunk previews.',
        inputSchema: z.object({ query: z.string().trim().min(1).max(500), limit: z.number().int().min(1).max(8).optional() }).strict(),
        readOnly: true,
        execute: async (input) => {
          const value = input as { query: string; limit?: number };
          return { matches: this.search(value.query, value.limit) };
        },
      },
      {
        name: 'read_source_chunk',
        description: 'Read one source chunk by the exact chunk id returned by the source index or search.',
        inputSchema: z.object({ chunkId: z.string().regex(/^source-\d{4}$/) }).strict(),
        readOnly: true,
        execute: async (input) => {
          const chunk = this.read((input as { chunkId: string }).chunkId);
          return chunk ? { found: true, chunk } : { found: false };
        },
      },
    ];
  }

  private chunk(text: string, targetTokens: number, overlapTokens: number) {
    const targetChars = Math.max(500, targetTokens * 2);
    const overlapChars = Math.min(targetChars - 100, Math.max(0, overlapTokens * 2));
    const paragraphs = text.split(/\r?\n+/).map((item) => item.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';
    const flush = () => {
      if (!current.trim()) return;
      chunks.push(current.trim());
      current = overlapChars ? current.slice(-overlapChars) : '';
    };
    for (const paragraph of paragraphs.length ? paragraphs : [text]) {
      if (paragraph.length > targetChars) {
        if (current) flush();
        for (let offset = 0; offset < paragraph.length; offset += targetChars - overlapChars) {
          chunks.push(paragraph.slice(offset, offset + targetChars));
        }
        current = '';
        continue;
      }
      if (current && current.length + paragraph.length + 1 > targetChars) flush();
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
    flush();
    return chunks.map((chunk, index) => ({
      id: `source-${String(index + 1).padStart(4, '0')}`,
      index,
      text: chunk,
      estimatedTokens: estimateTextTokens(chunk),
    }));
  }
}
