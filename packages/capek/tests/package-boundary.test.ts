import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { capekPackagePhase } from '@capekai/core';
import { jean2CompatibilityPhase } from '@capekai/core/compat/jean2';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const packageRoot = resolve(repositoryRoot, 'packages/capek');
const packageSourceRoot = resolve(packageRoot, 'src');
const serverSourceRoot = resolve(repositoryRoot, 'packages/server/src');
const ignoredDirectories = new Set([
  '.git',
  '.architecture-specs',
  'build',
  'client-dist',
  'coverage',
  'dev-dist',
  'dist',
  'node_modules',
  'storybook-static',
]);
const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];

function isWithin(path: string, parent: string): boolean {
  const relativePath = relative(parent, path);
  return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..');
}

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) {
      continue;
    }

    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
    } else if (sourceExtensions.some((extension) => path.endsWith(extension))) {
      files.push(path);
    }
  }

  return files;
}

function collectImports(path: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';

      if (isDynamicImport || isRequire) {
        imports.push(node.arguments[0].text);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function resolvesWithin(specifier: string, importer: string, target: string): boolean {
  return specifier.startsWith('.') && isWithin(resolve(dirname(importer), specifier), target);
}

describe('package boundary', () => {
  test('declared package entrypoints import by package name', () => {
    expect(capekPackagePhase).toBe(3);
    expect(jean2CompatibilityPhase).toBe(3);
  });

  test('external source does not import package internals', () => {
    const violations: string[] = [];

    for (const path of collectSourceFiles(repositoryRoot)) {
      if (isWithin(path, packageRoot)) {
        continue;
      }

      for (const specifier of collectImports(path)) {
        const importsSourcePath = specifier.includes('packages/capek/src');
        const importsPrivateSubpath = specifier === '@capekai/core/src'
          || specifier.startsWith('@capekai/core/src/');
        const resolvesIntoSource = resolvesWithin(specifier, path, packageSourceRoot);

        if (importsSourcePath || importsPrivateSubpath || resolvesIntoSource) {
          violations.push(`${relative(repositoryRoot, path)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('tool workspace policy files do not import Jean2 compatibility wrappers', () => {
    const policyFiles = [
      resolve(packageSourceRoot, 'tools/executor.ts'),
      resolve(packageSourceRoot, 'tools/workspace-capability.ts'),
    ];
    const violations = policyFiles.flatMap((path) => collectImports(path)
      .filter((specifier) => specifier.includes('compat/jean2-dependencies'))
      .map((specifier) => `${relative(repositoryRoot, path)} imports ${specifier}`));

    expect(violations).toEqual([]);
  });

  test('package source does not import Jean2 server internals', () => {
    const violations: string[] = [];

    for (const path of collectSourceFiles(packageSourceRoot)) {
      for (const specifier of collectImports(path)) {
        const importsServerPackage = specifier === '@jean2/server'
          || specifier.startsWith('@jean2/server/');
        const importsServerSourcePath = specifier.includes('packages/server/src');
        const resolvesIntoServerSource = resolvesWithin(specifier, path, serverSourceRoot);

        if (importsServerPackage || importsServerSourcePath || resolvesIntoServerSource) {
          violations.push(`${relative(repositoryRoot, path)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
