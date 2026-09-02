import { watch } from 'node:fs';
import { join } from 'node:path';
import { buildAgent, packageRoot } from './build-lib.mjs';

if (process.argv.includes('--build')) await buildAgent();

let debounceTimer;
let building = false;
let pending = false;
let stopping = false;

async function rebuild() {
  if (building) {
    pending = true;
    return;
  }
  building = true;
  do {
    pending = false;
    try {
      await buildAgent();
      console.log('[agent] rebuilt');
    } catch (error) {
      console.error('[agent] rebuild failed', error);
    }
  } while (pending && !stopping);
  building = false;
}

const watcher = watch(join(packageRoot, 'src'), { recursive: true }, () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => void rebuild(), 100);
});

console.log('[agent] watching src');

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(debounceTimer);
  watcher.close();
}

process.once('SIGINT', stop);
process.once('SIGTERM', stop);
