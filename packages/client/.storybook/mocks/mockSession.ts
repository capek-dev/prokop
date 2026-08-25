import type { Session, SessionStatus, SubagentStatus } from '@prokopai/sdk';
import { mockId, mockIsoNow, mockIsoMinutesAgo, merge } from './mockHelpers';
import { createWorkspace } from './mockWorkspace';

// =============================================================================
// Session Factory
// =============================================================================

export type MockSessionOverrides = Partial<Session>;

export function createSession(overrides: MockSessionOverrides = {}): Session {
  const id = overrides.id ?? mockId('sess');
  return merge<Session>(
    {
      id,
      workspaceId: overrides.workspaceId ?? createWorkspace().id,
      preconfigId: null,
      title: 'Chat session',
      status: 'active',
      createdAt: mockIsoMinutesAgo(30),
      updatedAt: mockIsoNow(),
      metadata: null,
      selectedModel: null,
      selectedProvider: null,
      selectedVariant: null,
      promptTokens: 1200,
      completionTokens: 800,
      totalTokens: 2000,
      parentId: null,
      agentName: null,
      subagentStatus: null,
      runningAt: null,
      compacting: false,
    },
    overrides,
  );
}

// =============================================================================
// Pre-built session variants
// =============================================================================

export const sessionPresets = {
  active: createSession({ title: 'Active chat session', status: 'active' }),
  closed: createSession({ title: 'Archived session', status: 'closed' }),
  untitled: createSession({ title: null, status: 'active' }),
  streaming: createSession({
    title: 'Currently streaming',
    status: 'active',
    runningAt: mockIsoMinutesAgo(1),
  }),
  compacting: createSession({
    title: 'Compacting...',
    status: 'active',
    compacting: true,
  }),
  subagent: createSession({
    title: 'Subagent: explore',
    status: 'active',
    parentId: mockId('parent-sess'),
    agentName: 'explore',
    subagentStatus: 'running',
    runningAt: mockIsoMinutesAgo(2),
  }),
  withHighTokens: createSession({
    title: 'Heavy session',
    status: 'active',
    promptTokens: 150_000,
    completionTokens: 32_000,
    totalTokens: 182_000,
  }),
} as const;

/** Create a list of sessions in various states */
export function createSessionList(count = 5): Session[] {
  return Array.from({ length: count }, (_, i) =>
    createSession({
      title: `Session ${i + 1}`,
      status: i < count - 1 ? ('closed' as SessionStatus) : 'active',
      createdAt: mockIsoMinutesAgo((count - i) * 60),
    }),
  );
}

/** Create a session with subagent children */
export function createSubagentSession(
  parentOverrides: MockSessionOverrides = {},
  childCount = 2,
): { parent: Session; children: Session[] } {
  const parent = createSession({ ...parentOverrides, agentName: null });
  const children: Session[] = Array.from({ length: childCount }, (_, i) =>
    createSession({
      parentId: parent.id,
      agentName: `subagent-${i}`,
      subagentStatus: (i === 0 ? 'running' : 'completed') as SubagentStatus,
      title: `Subagent task ${i + 1}`,
    }),
  );
  return { parent, children };
}
