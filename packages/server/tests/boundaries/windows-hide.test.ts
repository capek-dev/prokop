import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serverSourceRoot = resolve(import.meta.dir, '../../src');

/**
 * The Windows server runs detached without a console, so every console
 * child (git, codex, claude, cmd) opens a visible window unless it is
 * spawned with `windowsHide`.
 */
const EXEMPT: Record<string, string> = {
  // Starts the server itself; `detached` already gives it no console.
  'infrastructure/daemon/index.ts': 'detached server process',
  // `sh -c` branches only run on macOS and Linux; the Windows branch is hidden.
  'cli/update.ts': 'posix-only spawns',
  // ConPTY sessions are user-visible terminals rendered in the client.
  'transport/terminal/manager.ts': 'pty terminal',
};

function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let index = openParen; index < source.length; index++) {
    if (source[index] === '(') depth++;
    else if (source[index] === ')' && --depth === 0) return source.slice(openParen, index + 1);
  }
  return source.slice(openParen);
}

function unhiddenSpawns(): string[] {
  const failures: string[] = [];
  for (const file of new Bun.Glob('**/*.ts').scanSync(serverSourceRoot)) {
    if (file.endsWith('.test.ts') || EXEMPT[file]) continue;
    const source = readFileSync(resolve(serverSourceRoot, file), 'utf8');
    const importsSpawn = /import\s+(?:spawn|\{[^}]*\bspawn\b[^}]*\})\s+from\s+['"](?:node:child_process|child_process|cross-spawn)['"]/.test(source);
    const pattern = importsSpawn ? /\bBun\.spawn(?:Sync)?\(|(?<![.\w])spawn\(/g : /\bBun\.spawn(?:Sync)?\(/g;
    for (const match of source.matchAll(pattern)) {
      const call = callArguments(source, match.index + match[0].length - 1);
      if (!call.includes('windowsHide')) {
        failures.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
  }
  return failures;
}

describe('Windows child processes', () => {
  test('every server spawn hides its console window', () => {
    expect(unhiddenSpawns()).toEqual([]);
  });
});
