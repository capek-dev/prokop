import { expect, test } from 'bun:test';
import type { Workspace } from '@prokopai/sdk';
import { cliWorkspaceAvailable } from '@/harnesses/shared/cli-workspace';

function workspace(overrides: Partial<Workspace>): Workspace {
  return { id: 'ws', name: 'ws', path: '/tmp/ws', isVirtual: false, settings: {}, ...overrides } as unknown as Workspace;
}

test('CLI workspace check requires a real root, with agent homes exempt from the virtual block', () => {
  expect(cliWorkspaceAvailable(null)).toBe(false);
  expect(cliWorkspaceAvailable(workspace({ path: undefined }))).toBe(false);
  expect(cliWorkspaceAvailable(workspace({ isVirtual: true }))).toBe(false);
  // Agent homes are virtual rows backed by a real directory: reviews run there.
  expect(cliWorkspaceAvailable(workspace({ isVirtual: true, settings: { isAgentHome: true } }))).toBe(true);
  expect(cliWorkspaceAvailable(workspace({}))).toBe(true);
});
