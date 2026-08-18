import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const forbiddenSpecifier = ['@jean2', '/'].join('');

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectTypeScriptFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

function packageDependencyNames(packagePath: string): string[] {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ];
}

describe('Capek package dependency boundary', () => {
  test('Capek source and tests contain no Jean2 package specifiers', () => {
    const files = [
      ...collectTypeScriptFiles(resolve(repositoryRoot, 'packages/capek/src')),
      ...collectTypeScriptFiles(resolve(repositoryRoot, 'packages/capek/tests')),
    ];
    const violations = files.filter((file) => readFileSync(file, 'utf8').includes(forbiddenSpecifier));
    expect(violations).toEqual([]);
  });

  test('Capek packages declare no Jean2 dependencies', () => {
    const packages = ['capek', 'capek-types', 'capek-tool'];
    const violations = packages.flatMap((name) => packageDependencyNames(
      resolve(repositoryRoot, `packages/${name}/package.json`),
    ).filter((dependency) => dependency.startsWith(forbiddenSpecifier)));
    expect(violations).toEqual([]);
  });
});
