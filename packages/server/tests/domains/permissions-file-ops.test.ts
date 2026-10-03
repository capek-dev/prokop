import { describe, expect, test } from 'bun:test';
import {
  classifyFileOperation,
  requiresHumanReview,
} from '@/domains/permissions';
import { fileConcernAsk } from '@/harnesses/prokop/tools/file-permission';

const root = '/workspace';

describe('classifyFileOperation (shared file-op analysis)', () => {
  test('clean workspace operations classify low risk with no concerns', () => {
    const result = classifyFileOperation({
      operation: 'edit', paths: [`${root}/src/app.ts`], roots: [root],
    });
    expect(result?.finding.concerns).toEqual([]);
    expect(result?.ask.risk).toBe('low');
    expect(result?.ask.allowedScopes).toEqual(['once', 'session', 'workspace']);
    expect(requiresHumanReview(result!.finding)).toBe(false);
  });

  test('read-only roots satisfy reads and searches but not writes or deletes', () => {
    const readRoots = ['/agent'];
    const concernsFor = (operation: 'read' | 'search' | 'edit' | 'delete') => classifyFileOperation({
      operation, paths: ['/agent/skills/x/SKILL.md'], roots: [root], readRoots,
    })?.finding.concerns;
    expect(concernsFor('read')).toEqual([]);
    expect(concernsFor('search')).toEqual([]);
    expect(concernsFor('edit')).toEqual(['escape']);
    expect(concernsFor('delete')).toEqual(['escape', 'destructive']);
  });

  test('sensitive paths raise the sensitive concern and high risk', () => {
    const result = classifyFileOperation({
      operation: 'read', paths: [`${root}/.env`], roots: [root],
    });
    expect(result?.finding.concerns).toEqual(['sensitive']);
    expect(result?.ask.risk).toBe('high');
    expect(result?.ask.resource).toBe('file');
    expect(result?.ask.action).toBe('read');
  });

  test('credentials source names and search patterns do not require sensitive-file approval', () => {
    for (const path of ['credentials', 'credentials.json', 'src/credentials.ts', 'src/provider-credentials.ts', 'credentials/index.ts']) {
      for (const operation of ['read', 'edit', 'write', 'search'] as const) {
        const result = classifyFileOperation({
          operation, paths: [`${root}/${path}`], roots: [root], pattern: '**/*credentials*',
        });
        expect(result?.finding.concerns).toEqual([]);
      }
    }
  });

  test('known credential stores remain sensitive', () => {
    for (const path of ['.git-credentials', '.aws/credentials']) {
      expect(classifyFileOperation({
        operation: 'read', paths: [`${root}/${path}`], roots: [root],
      })?.finding.concerns).toEqual(['sensitive']);
    }
  });

  test('escape means outside every provided root', () => {
    const inside = classifyFileOperation({
      operation: 'read', paths: ['/allowed/notes.txt'], roots: [root, '/allowed'],
    });
    expect(inside?.finding.concerns).toEqual([]);

    const outside = classifyFileOperation({
      operation: 'read', paths: ['/etc/hosts'], roots: [root, '/allowed'],
    });
    expect(outside?.finding.concerns).toEqual(['escape']);
    expect(outside?.ask.risk).toBe('medium');
  });

  test('deletes are destructive regardless of target', () => {
    const result = classifyFileOperation({
      operation: 'delete', paths: [`${root}/old.ts`], roots: [root],
    });
    expect(result?.finding.concerns).toEqual(['destructive']);
    expect(result?.ask.risk).toBe('high');
    // Destructive findings are once-only (grantScopesForFinding).
    expect(result?.ask.allowedScopes).toEqual(['once']);
  });

  test('sensitive search patterns classify even when the directory is clean', () => {
    const result = classifyFileOperation({
      operation: 'search', paths: [`${root}/src`], roots: [root], pattern: '**/.env*',
    });
    expect(result?.finding.concerns).toEqual(['sensitive']);
  });

  test('concerns compose and the ask carries the full v2 shape', () => {
    const result = classifyFileOperation({
      operation: 'delete', paths: ['/outside/u/.ssh/config'], roots: [root],
    });
    expect(result?.finding.concerns).toEqual(['escape', 'sensitive', 'destructive']);
    expect(result?.ask.risk).toBe('high');
    expect(result?.ask.concerns).toEqual(['escape', 'sensitive', 'destructive']);
    expect(result?.ask.catastrophic).toBe(false);
    expect(result?.ask.action).toBe('delete');
  });

  test('malformed input returns undefined (caller keeps its legacy behavior)', () => {
    expect(classifyFileOperation({ operation: 'read', paths: [], roots: [root] })).toBeUndefined();
    expect(classifyFileOperation({ operation: 'read', paths: ['/a'], roots: [] })).toBeUndefined();
    expect(classifyFileOperation({ operation: 'read', paths: ['/a\0b'], roots: [root] })).toBeUndefined();
  });
});

describe('fileConcernAsk (prokop tool ask enrichment)', () => {
  test('enriches a sensitive ask: derived risk, concerns, paths; question and grant key pass through', () => {
    const ask = fileConcernAsk({
      operation: 'edit', path: `${root}/.env`, root, concern: 'sensitive',
      ask: {
        type: 'permission',
        question: 'Editing sensitive files requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'file_pattern:sensitive', permissionType: 'action' },
      },
    });
    expect(ask.question).toBe('Editing sensitive files requires approval.');
    expect(ask.metadata).toMatchObject({ permissionKey: 'file_pattern:sensitive' });
    expect(ask.risk).toBe('high');
    expect(ask.concerns).toEqual(['sensitive']);
    expect(ask.catastrophic).toBe(false);
    expect(ask.resource).toBe('file');
    expect(ask.action).toBe('write');
    expect(ask.paths).toEqual([`${root}/.env`]);
    expect(ask.evidence).toEqual(['touches sensitive files (credentials, keys, environment)']);
  });

  test('escape asks keep their medium risk (parity with the old pinned value)', () => {
    const ask = fileConcernAsk({
      operation: 'write', path: '/etc/app.conf', root, concern: 'escape',
      ask: {
        type: 'permission',
        question: 'Writing files outside the workspace requires approval.',
        risk: 'medium',
        metadata: { permissionKey: 'path:outside_workspace', permissionType: 'action' },
      },
    });
    expect(ask.risk).toBe('medium');
    expect(ask.concerns).toEqual(['escape']);
    expect(ask.evidence).toEqual(['touches paths outside the allowed roots']);
  });
});
