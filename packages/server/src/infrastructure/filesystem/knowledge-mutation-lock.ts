import { AsyncLocalStorage } from 'node:async_hooks';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const tails = new Map<string, Promise<void>>();
const active = new AsyncLocalStorage<{ held: boolean }>();

function directoryKey(directory: string): string {
  if (!directory.trim() || directory.includes('\0')) throw new Error('Invalid knowledge directory');
  let current = resolve(directory);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(current), ...missing.reverse());
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** Serialize managed read-modify-write operations by canonical directory.
 * Process-local only: external writers must be handled by host revision policy.
 * Do not call managed memory/skill mutators inside this callback; they acquire
 * the same primitive themselves. Permission waits belong outside the lock. */
export async function withKnowledgeMutationLock<T>(directory: string, callback: () => Promise<T>): Promise<T> {
  if (active.getStore()?.held) throw new Error('Nested knowledge mutation locks are not supported');
  const key = directoryKey(directory);
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>(resolve => { release = resolve; });
  tails.set(key, tail);
  await previous;
  const state = { held: true };
  try {
    return await active.run(state, callback);
  } finally {
    state.held = false;
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
