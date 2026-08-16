import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { parseImports, scanDirectory } from '../helpers/import-scan';
import serverPackage from '../../package.json';

const serverSourceRoot = resolve(import.meta.dir, '../../src');
const forbiddenPackages = [
  'ai',
  '@ai-sdk/',
  '@openrouter/ai-sdk-provider',
  'vercel-minimax-ai-provider',
  'zhipu-ai-provider',
];

function isForbidden(specifier: string): boolean {
  return forbiddenPackages.some(candidate => (
    candidate.endsWith('/') ? specifier.startsWith(candidate) : specifier === candidate
  ));
}

describe('S7 server AI SDK boundary', () => {
  test('server source imports no AI SDK or provider SDK', () => {
    const violations = scanDirectory(serverSourceRoot).flatMap(file => (
      parseImports(file.sourceText, file.path)
        .filter(item => isForbidden(item.specifier))
        .map(item => `${file.path}: ${item.specifier}`)
    ));

    expect(violations).toEqual([]);
  });

  test('server package declares no AI SDK or provider SDK dependency', () => {
    const dependencies = Object.keys(serverPackage.dependencies);
    expect(dependencies.filter(isForbidden)).toEqual([]);
  });
});
