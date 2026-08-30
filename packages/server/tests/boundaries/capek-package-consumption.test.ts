import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

interface PackageManifest {
  workspaces?: string[];
  dependencies?: Record<string, string>;
}

const repositoryRoot = resolve(import.meta.dir, '../../../..');

async function readJson<T>(path: string): Promise<T> {
  return Bun.file(resolve(repositoryRoot, path)).json() as Promise<T>;
}

async function readText(path: string): Promise<string> {
  return Bun.file(resolve(repositoryRoot, path)).text();
}

const capekVersions = {
  '@capekai/core': '^1.0.2',
  '@capekai/tool': '^1.0.1',
  '@capekai/types': '^1.0.1',
} as const;

function expectDependency(
  manifest: PackageManifest,
  packageName: keyof typeof capekVersions,
): void {
  expect(manifest.dependencies?.[packageName]).toBe(capekVersions[packageName]);
}

describe('Čapek npm package consumption', () => {
  test('local Čapek source directories are absent from the Prokop repository', async () => {
    const rootPackage = await readJson<PackageManifest>('package.json');
    const localPackages = ['capek', 'capek-tool', 'capek-types'];

    for (const packageName of localPackages) {
      expect(existsSync(resolve(repositoryRoot, 'packages', packageName))).toBe(false);
      expect(rootPackage.workspaces).not.toContain(`!packages/${packageName}`);
    }
  });

  test('consumers declare published package versions instead of workspace links', async () => {
    const [serverPackage, sdkPackage, toolsPackage] = await Promise.all([
      readJson<PackageManifest>('packages/server/package.json'),
      readJson<PackageManifest>('packages/sdk/package.json'),
      readJson<PackageManifest>('tools/package.json'),
    ]);

    expectDependency(serverPackage, '@capekai/core');
    expectDependency(serverPackage, '@capekai/tool');
    expectDependency(serverPackage, '@capekai/types');
    expectDependency(sdkPackage, '@capekai/tool');
    expectDependency(sdkPackage, '@capekai/types');
    expectDependency(toolsPackage, '@capekai/tool');
  });

  test('Čapek packages bypass the three-day release-age cooldown', async () => {
    const bunfig = await readText('bunfig.toml');

    expect(bunfig).toContain(
      'minimumReleaseAgeExcludes = ["@capekai/core", "@capekai/tool", "@capekai/types"]',
    );
  });

  test('tool compilation and lock resolution do not point at local Čapek source', async () => {
    const [toolsTsconfig, lockfile] = await Promise.all([
      readText('tools/tsconfig.json'),
      readText('bun.lock'),
    ]);

    expect(toolsTsconfig).not.toContain('packages/capek-tool');
    expect(lockfile).not.toContain('@capekai/core@workspace:');
    expect(lockfile).not.toContain('@capekai/tool@workspace:');
    expect(lockfile).not.toContain('@capekai/types@workspace:');
    expect(lockfile).toContain('@capekai/core@1.0.2');
    expect(lockfile).toContain('@capekai/tool@1.0.1');
    expect(lockfile).toContain('@capekai/types@1.0.1');
  });
});
