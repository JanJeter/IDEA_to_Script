import { randomBytes } from 'node:crypto';

const requested = Number.parseInt(process.argv[2] ?? '100', 10);
if (!Number.isInteger(requested) || requested < 1 || requested > 500) {
  console.error('Usage: npm run access-codes:generate -- <count from 1 to 500>');
  process.exitCode = 1;
} else {
  const width = Math.max(3, String(requested).length);
  const codes = Array.from({ length: requested }, (_, index) => {
    const seat = String(index + 1).padStart(width, '0');
    return `IDS-${seat}-${randomBytes(12).toString('base64url')}`;
  });
  console.log(`APP_ACCESS_CODES=${codes.join(',')}`);
}
