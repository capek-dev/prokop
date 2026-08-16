import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  autoApproveSeverityOf,
  DEFAULT_WORKSPACE_SETTINGS,
  expandPath,
  isAgentHomeWorkspace,
  isInsideUnselectedAdditionalRoot,
  isPathInside,
  isPathWithinWorkspace,
  mapWorkspaceRecord,
  parseWorkspaceSettings,
  resolveCandidatePath,
  resolveRootForQuery,
  selectEditableRoot,
  workspaceNameOrDefault,
} from '@/domains/workspaces';

describe('workspace domain: record policy', () => {
  test('pins the default settings and the malformed-JSON fallback', () => {
    expect(DEFAULT_WORKSPACE_SETTINGS).toEqual({ autoApproveSeverity: 'low' });
    expect(parseWorkspaceSettings(null)).toEqual({ autoApproveSeverity: 'low' });
    expect(parseWorkspaceSettings('{"memory":{"enabled":true}}')).toMatchObject({
      autoApproveSeverity: 'low',
      memory: { enabled: true },
    });
    expect(parseWorkspaceSettings('not json')).toEqual({ autoApproveSeverity: 'low' });
  });

  test('maps raw rows with the exact record shape', () => {
    expect(mapWorkspaceRecord({
      id: 'ws1',
      name: 'Main',
      path: '/main',
      is_virtual: 1,
      settings: '{"scheduling":{"enabled":true}}',
      created_at: 'c',
      updated_at: 'u',
    }, ['/extra'])).toMatchObject({
      id: 'ws1',
      name: 'Main',
      path: '/main',
      isVirtual: true,
      additionalPaths: ['/extra'],
      settings: { autoApproveSeverity: 'low', scheduling: { enabled: true } },
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(mapWorkspaceRecord({
      id: 'ws2',
      name: 'P',
      path: '/p',
      is_virtual: 0,
      settings: null,
      created_at: 'c',
      updated_at: 'u',
    }).additionalPaths).toEqual([]);
  });

  test('classifies agent homes, resolves auto-approve fallbacks, and defaults names', () => {
    expect(isAgentHomeWorkspace({ autoApproveSeverity: 'low' })).toBe(false);
    expect(isAgentHomeWorkspace({ isAgentHome: true })).toBe(true);
    expect(autoApproveSeverityOf(null)).toBe('low');
    expect(autoApproveSeverityOf(undefined)).toBe('low');
    expect(autoApproveSeverityOf({ settings: { autoApproveSeverity: 'medium' } })).toBe('medium');
    expect(workspaceNameOrDefault(undefined)).toBe('New Workspace');
    expect(workspaceNameOrDefault('Named')).toBe('Named');
  });
});

describe('workspace domain: file-access policy', () => {
  test('expandPath expands home paths and resolves', () => {
    expect(expandPath('~/notes', '/home/user')).toBe('/home/user/notes');
    expect(expandPath('/abs/path', '/home/user')).toBe('/abs/path');
    // Relative inputs resolve against the process cwd, exactly like the
    // pre-domain expandPath.
    expect(expandPath('relative', '/home/user')).toBe(join(process.cwd(), 'relative'));
  });

  test('isPathWithinWorkspace preserves the containment matrix', () => {
    expect(isPathWithinWorkspace('/main/sub', '/main')).toBe(true);
    expect(isPathWithinWorkspace('/main', '/main')).toBe(true);
    // Separator-aware: /main-other must not match /main.
    expect(isPathWithinWorkspace('/main-other/x', '/main')).toBe(false);
    expect(isPathWithinWorkspace('/outside', '/main')).toBe(false);
    expect(isPathWithinWorkspace('../escape', '/main')).toBe(false);
    expect(isPathWithinWorkspace('/extra/sub', '/main', ['/extra'])).toBe(true);
    expect(isPathWithinWorkspace('/other', '/main', ['/extra'])).toBe(false);
  });

  test('isPathInside is separator-aware and covers the root', () => {
    expect(isPathInside('/foo/bar', '/foo')).toBe(true);
    expect(isPathInside('/foo', '/foo')).toBe(true);
    expect(isPathInside('/foobar', '/foo')).toBe(false);
    expect(isPathInside('/anything', '/')).toBe(true);
  });

  test('unselected additional roots are detected exactly', () => {
    expect(isInsideUnselectedAdditionalRoot('/extra/x', '/main', ['/extra'])).toBe(true);
    expect(isInsideUnselectedAdditionalRoot('/extra/x', '/extra', ['/extra'])).toBe(false);
    expect(isInsideUnselectedAdditionalRoot('/main/x', '/main', ['/extra'])).toBe(false);
  });

  test('resolveCandidatePath anchors relative inputs and passes absolutes through', () => {
    expect(resolveCandidatePath('/root', 'sub/file.ts')).toBe('/root/sub/file.ts');
    expect(resolveCandidatePath('/root', '/abs/file.ts')).toBe('/abs/file.ts');
    expect(resolveCandidatePath('/root', 'sub\\win.ts')).toBe('/root/sub/win.ts');
  });

  test('resolveRootForQuery falls back to the main root for missing or invalid roots', () => {
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(resolveRootForQuery(workspace)).toEqual({ root: '/main', isMain: true });
    expect(resolveRootForQuery(workspace, '/extra')).toEqual({ root: '/extra', isMain: false });
    expect(resolveRootForQuery(workspace, '/main')).toEqual({ root: '/main', isMain: true });
    expect(resolveRootForQuery(workspace, '/other')).toEqual({ root: '/main', isMain: true });
  });

  test('selectEditableRoot rejects roots outside the workspace and additional roots', () => {
    const workspace = { path: '/main', additionalPaths: ['/extra'] };
    expect(selectEditableRoot(workspace)).toEqual({ root: '/main', valid: true });
    expect(selectEditableRoot(workspace, '/extra')).toEqual({ root: '/extra', valid: true });
    expect(selectEditableRoot(workspace, '/other').valid).toBe(false);
  });
});
