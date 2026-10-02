import { describe, expect, test } from 'vitest';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import { getWorkspaceDefaultPreconfigId, getWorkspacePreconfigs } from '@/lib/workspacePreconfigs';

const preconfigs = [
  { id: 'general', name: 'General', mode: 'primary' },
  { id: 'coder', name: 'Coder', mode: 'primary' },
  { id: 'explore', name: 'Explore', mode: 'subagent' },
  { id: 'helper', name: 'Helper', mode: 'both' },
] as Preconfig[];

function workspace(settings: Workspace['settings']): Workspace {
  return {
    id: 'workspace',
    name: 'Workspace',
    path: '/workspace',
    isVirtual: true,
    additionalPaths: [],
    settings,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('getWorkspaceDefaultPreconfigId', () => {
  test('uses the owning agent in an agent home', () => {
    expect(getWorkspaceDefaultPreconfigId(
      workspace({ isAgentHome: true, agentId: 'coder' }),
      preconfigs,
    )).toBe('coder');
  });

  test('preserves an explicit workspace default', () => {
    expect(getWorkspaceDefaultPreconfigId(
      workspace({ preconfigs: { defaultId: 'general', selectedIds: ['general'] } }),
      preconfigs,
    )).toBe('general');
  });

  test('falls back to the first primary preconfig when no default is set', () => {
    expect(getWorkspaceDefaultPreconfigId(workspace({}), preconfigs)).toBe('general');
    expect(getWorkspaceDefaultPreconfigId(null, preconfigs)).toBe('general');
  });

  test('stale selectedIds never filter the default: null means all visible', () => {
    // The per-workspace selection list is gone; a stored legacy value is
    // ignored rather than narrowing the fallback.
    expect(getWorkspaceDefaultPreconfigId(
      workspace({ preconfigs: { selectedIds: ['coder'], defaultId: null } }),
      preconfigs,
    )).toBe('general');
  });
});

describe('getWorkspacePreconfigs', () => {
  test('every primary/both preconfig is visible; subagent-only ones are not', () => {
    expect(getWorkspacePreconfigs(workspace({}), preconfigs).map(p => p.id))
      .toEqual(['general', 'coder', 'helper']);
    expect(getWorkspacePreconfigs(null, preconfigs).map(p => p.id))
      .toEqual(['general', 'coder', 'helper']);
  });
});
