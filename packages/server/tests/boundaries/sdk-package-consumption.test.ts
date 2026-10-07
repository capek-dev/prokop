import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parseImports } from '#tests/helpers/import-scan';

interface PackageManifest {
  name: string;
  private?: boolean;
  publishConfig?: unknown;
  dependencies?: Record<string, string>;
}

const repositoryRoot = resolve(import.meta.dir, '../../../..');
const contractPackages = {
  '@prokopai/sdk': 'sdk',
} as const;

async function readManifest(directory: string): Promise<PackageManifest> {
  return Bun.file(resolve(repositoryRoot, 'packages', directory, 'package.json')).json();
}

describe('Prokop SDK package', () => {
  test('the contracts workspace has been absorbed', () => {
    expect(existsSync(resolve(repositoryRoot, 'packages/contracts/package.json'))).toBe(false);
  });

  test('types and tools cannot load client implementations or server code', () => {
    const sdkSource = resolve(repositoryRoot, 'packages/sdk/src');
    const pending = ['@prokopai/sdk/types', '@prokopai/sdk/tool'].map(name => Bun.resolveSync(name, import.meta.dir));
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const path = relative(sdkSource, file);
      expect(path.startsWith('..')).toBe(false);
      expect(path).not.toMatch(/^(?:client\.ts|index\.ts|transport\/|rest\/|namespaces\/)/);
      for (const imported of parseImports(readFileSync(file, 'utf8'), file)) {
        pending.push(Bun.resolveSync(imported.specifier, dirname(file)));
      }
    }
    expect(visited.size).toBeGreaterThan(10);
  });

  test('contracts have no runtime dependencies', async () => {
    expect((await readManifest('sdk')).dependencies ?? {}).toEqual({});
  });
  test('contract packages are private and resolve to this checkout', async () => {
    for (const [name, directory] of Object.entries(contractPackages)) {
      const manifest = await readManifest(directory);
      expect(manifest.name).toBe(name);
      expect(manifest.private).toBe(true);
      expect(manifest.publishConfig).toBeUndefined();
      expect(realpathSync(Bun.resolveSync(name, import.meta.dir))).toBe(
        realpathSync(resolve(repositoryRoot, 'packages', directory, 'src/index.ts')),
      );
    }
  });

  test('all product consumers use workspace dependencies', async () => {
    for (const directory of ['server', 'client', 'browser', ...Object.values(contractPackages)]) {
      const manifest = await readManifest(directory);
      for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
        if (name in contractPackages) expect(version).toBe('workspace:*');
      }
    }
  });

  test('lockfile resolves the contracts locally without a registry artifact', async () => {
    const lockfile = await Bun.file(resolve(repositoryRoot, 'bun.lock')).text();
    for (const [name, directory] of Object.entries(contractPackages)) {
      expect(lockfile).toContain(`${name}@workspace:packages/${directory}`);
      expect(lockfile).not.toMatch(new RegExp(`${name}@\\d`));
    }
  });
});
