import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = resolve(packageRoot, '..', '..');
const cacheRoot = join(workspaceRoot, 'node_modules', '.cache');
const lockPath = join(cacheRoot, 'idea2screenplay-agent-build.lock');
const tscPath = require.resolve('typescript/bin/tsc');

const wait = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

async function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function lockState() {
  try {
    const [contents, metadata] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath),
    ]);
    const parsed = JSON.parse(contents);
    return {
      token: typeof parsed.token === 'string' ? parsed.token : undefined,
      pid: Number(parsed.pid),
      ageMs: Date.now() - metadata.mtimeMs,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    return { ageMs: 0 };
  }
}

async function removeOwnedLock(token) {
  const current = await lockState();
  if (current?.token !== token) return;
  await unlink(lockPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}

async function acquireBuildLock() {
  await mkdir(cacheRoot, { recursive: true });
  const deadline = Date.now() + 2 * 60 * 1000;
  while (true) {
    const token = `${process.pid}:${randomUUID()}`;
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }));
      await handle.close();
      return () => removeOwnedLock(token);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await lockState();
      const stale = current && (
        current.ageMs > 5 * 60 * 1000
        || (Number.isInteger(current.pid) && !(await processIsAlive(current.pid)))
      );
      if (stale) {
        await unlink(lockPath).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error('Timed out waiting for the Agent build lock');
      }
      await wait(100);
    }
  }
}

function runTsc() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [tscPath, '-p', 'tsconfig.build.json'],
      { cwd: packageRoot, stdio: 'inherit' },
    );
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`Agent TypeScript build failed (${signal ?? code})`));
    });
  });
}

export async function copySkillAssets() {
  await mkdir(join(packageRoot, 'dist', 'skills'), { recursive: true });
  await cp(join(packageRoot, 'src', 'skills'), join(packageRoot, 'dist', 'skills'), {
    recursive: true,
    filter: (source) => !source.endsWith('.ts'),
  });
}

export async function buildAgent() {
  const release = await acquireBuildLock();
  try {
    await runTsc();
    await copySkillAssets();
  } finally {
    await release();
  }
}
