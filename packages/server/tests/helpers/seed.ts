import { createWorkspace, type CreateWorkspaceInput } from '@/infrastructure/sqlite/workspaces';
import { createSession } from '@/infrastructure/sqlite/session-store';
import { createTestSession } from './factories';

const DEFAULT_WORKSPACE: CreateWorkspaceInput = {
  id: 'ws1',
  name: 'Test Workspace',
  path: '/test',
  isVirtual: false,
};

export function seedWorkspace(
  overrides: Partial<CreateWorkspaceInput> = {},
): CreateWorkspaceInput & { id: string } {
  const input = { ...DEFAULT_WORKSPACE, ...overrides };
  createWorkspace(input);
  return input;
}

export function seedSession(
  workspaceId: string = 'ws1',
  overrides: Partial<Omit<import('@prokopai/sdk').Session, 'createdAt' | 'updatedAt'>> = {},
): import('@prokopai/sdk').Session {
  const defaults = createTestSession({ workspaceId });
  const { createdAt: _c, updatedAt: _u, ...sessionInput } = defaults;
  return createSession({
    ...sessionInput,
    ...overrides,
  });
}

export function seedWorkspaceWithSession(
  wsOverrides: Partial<CreateWorkspaceInput> = {},
  sessionOverrides: Partial<Omit<import('@prokopai/sdk').Session, 'createdAt' | 'updatedAt'>> = {},
): { workspaceId: string; sessionId: string } {
  const ws = seedWorkspace(wsOverrides);
  const session = seedSession(ws.id, sessionOverrides);
  return { workspaceId: ws.id, sessionId: session.id };
}
