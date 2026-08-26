import { describe, expect, test } from 'vitest';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import { getWorkspaceDefaultPreconfigId } from '@/lib/workspacePreconfigs';

const preconfigs = [
  { id: 'general', name: 'General', mode: 'primary' },
  { id: 'coder', name: 'Coder', mode: 'primary' },
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
});
