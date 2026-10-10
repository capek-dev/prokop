import { expect, test } from 'bun:test';
import type { Workspace } from '@prokopai/sdk';
import { cliWorkspaceAvailable } from '@/harnesses/shared/cli-workspace';

function workspace(overrides: Partial<Workspace>): Workspace {
  return { id: 'ws', name: 'ws', path: '/tmp/ws', isVirtual: false, settings: {}, ...overrides } as unknown as Workspace;
}

test('CLI workspace check requires a root folder, virtual or not', () => {
  expect(cliWorkspaceAvailable(null)).toBe(false);
  expect(cliWorkspaceAvailable(workspace({ path: undefined }))).toBe(false);
  expect(cliWorkspaceAvailable(workspace({ path: '' }))).toBe(false);
  // Virtual workspaces and agent homes are backed by a Prokop-created folder.
  expect(cliWorkspaceAvailable(workspace({ isVirtual: true }))).toBe(true);
  expect(cliWorkspaceAvailable(workspace({ isVirtual: true, settings: { isAgentHome: true } }))).toBe(true);
  expect(cliWorkspaceAvailable(workspace({}))).toBe(true);
});
