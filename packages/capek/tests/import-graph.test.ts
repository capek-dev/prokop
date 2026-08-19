import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const srcRoot = resolve(import.meta.dir, '../src');

// Static imports only: `import 'x'`, `import ... from 'x'`,
// `export ... from 'x'`, `require('x')`. Dynamic `import('x')` is
// intentionally excluded — laziness is exactly what this test protects.
const STATIC_IMPORT = /(?:^|\n)\s*(?:import\s[^;'"]*?from\s*['"]|import\s*['"]|export\s[^;'"]*?from\s*['"]|require\(\s*['"])([^'"]+)['"]/g;

function staticImportsOfFile(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) specifiers.push(match[1]!);
  return specifiers;
}

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function reachableFiles(entry: string): Set<string> {
  const visited = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of staticImportsOfFile(file)) {
      if (!specifier.startsWith('.')) continue;
      const resolved = resolveModule(file, specifier);
      if (resolved) queue.push(resolved);
    }
  }
  return visited;
}

describe('package entry import graph', () => {
  test('the main entry never statically reaches bun:sqlite', () => {
    const files = reachableFiles(join(srcRoot, 'index.ts'));
    const offenders = [...files].filter((file) =>
      staticImportsOfFile(file).includes('bun:sqlite'));
    expect(offenders).toEqual([]);
    // The sqlite drivers exist but are only reachable via dynamic import
    // from storage/options.ts.
    expect(files.has(join(srcRoot, 'storage/sqlite.ts'))).toBe(false);
    expect(files.has(join(srcRoot, 'storage/sqlite-tool-output-artifacts.ts'))).toBe(false);
  });
});
