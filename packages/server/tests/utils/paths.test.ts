import { describe, expect, test } from 'bun:test';
import { resolve } from 'path';
import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';

describe('server workspace paths', () => {
  test('resolves workspace-relative and absolute paths', () => {
    expect(workspacePathPolicyPort.resolvePath('src/index.ts', '/workspace/project'))
      .toBe(resolve('/workspace/project/src/index.ts'));
    expect(workspacePathPolicyPort.resolvePath('/outside/file.txt', '/workspace/project'))
      .toBe(resolve('/outside/file.txt'));
  });

  test('accepts workspace and additional-root descendants', () => {
    expect(workspacePathPolicyPort.isPathWithinWorkspace('/workspace/project', '/workspace/project')).toBe(true);
    expect(workspacePathPolicyPort.isPathWithinWorkspace('/workspace/project/src/index.ts', '/workspace/project')).toBe(true);
    expect(workspacePathPolicyPort.isPathWithinWorkspace(
      '/workspace/shared/file.txt',
      '/workspace/project',
      ['/workspace/shared'],
    )).toBe(true);
  });

  test('rejects workspace and additional-root sibling prefixes', () => {
    expect(workspacePathPolicyPort.isPathWithinWorkspace('/workspace/project-other/file.txt', '/workspace/project')).toBe(false);
    expect(workspacePathPolicyPort.isPathWithinWorkspace(
      '/workspace/shared-other/file.txt',
      '/workspace/project',
      ['/workspace/shared'],
    )).toBe(false);
  });

  test('resolves only exact declared roots', () => {
    const workspace = {
      path: '/workspace/project',
      additionalPaths: ['/workspace/shared'],
    };

    expect(workspacePathPolicyPort.resolveRootForQuery(workspace, '/workspace/shared'))
      .toEqual({ root: resolve('/workspace/shared'), isMain: false });
    expect(workspacePathPolicyPort.resolveRootForQuery(workspace, '/workspace/shared/nested'))
      .toEqual({ root: resolve('/workspace/project'), isMain: true });
  });
});
