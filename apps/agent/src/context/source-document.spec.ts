import { SourceDocument } from './source-document';

describe('SourceDocument', () => {
  it('keeps a 6000-character Chinese source available without losing content', () => {
    const text = '一个人在城市里寻找失踪的家人。'.repeat(450);
    expect(text.length).toBeGreaterThan(6_000);
    const source = new SourceDocument(text, 800, 80);
    expect(source.chunks.length).toBeGreaterThan(1);
    expect(source.chunks.every((chunk) => chunk.estimatedTokens > 0)).toBe(true);
    expect(source.read('source-0001')?.text).toContain('寻找失踪的家人');
  });

  it('supports bounded lexical retrieval without a vector database', () => {
    const source = new SourceDocument('第一章：旧影院即将拆除。\n第二章：导演寻找遗失的胶片。', 10, 0);
    expect(source.search('遗失的胶片')).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^source-/), score: expect.any(Number) }),
    ]);
  });
});
