import { isPrivateOrReservedAddress, safePublicSourceUrl, sanitizePlainText } from './trend-text';

describe('trend text boundaries', () => {
  it('strips markup, invisible characters and caps persisted excerpts', () => {
    expect(sanitizePlainText('<b>热点</b>\u200b  内容', 4)).toBe('热点 内');
    expect(sanitizePlainText('a'.repeat(600), 500)).toHaveLength(500);
  });

  it('rejects private, loopback, link-local and credentialed public links', () => {
    expect(isPrivateOrReservedAddress('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedAddress('10.1.2.3')).toBe(true);
    expect(isPrivateOrReservedAddress('169.254.1.1')).toBe(true);
    expect(isPrivateOrReservedAddress('::1')).toBe(true);
    expect(isPrivateOrReservedAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateOrReservedAddress('8.8.8.8')).toBe(false);
    expect(safePublicSourceUrl('http://example.com/item')).toBeNull();
    expect(safePublicSourceUrl('https://user:secret@example.com/item')).toBeNull();
    expect(safePublicSourceUrl('https://127.0.0.1/item')).toBeNull();
    expect(safePublicSourceUrl('https://example.com/item')).toBe('https://example.com/item');
  });
});
