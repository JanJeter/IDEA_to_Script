import { cp, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(`${packageRoot}/dist/skills`, { recursive: true });
await cp(`${packageRoot}/src/skills`, `${packageRoot}/dist/skills`, {
  recursive: true,
  filter: (source) => !source.endsWith('.ts'),
});
