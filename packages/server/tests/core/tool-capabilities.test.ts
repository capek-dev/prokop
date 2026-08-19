import { describe, test, expect } from 'bun:test';
import type { Session } from '@jean2/sdk';

type SessionLookup = (id: string) => Session | null;

let sessionLookup: SessionLookup = () => null;

function mockSessionLookup(sessions: Record<string, Session | null>): void {
  sessionLookup = (id: string) => sessions[id] ?? null;
}

describe('isToolAllowedInContext', () => {
  test('returns true when capabilities are undefined', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext(undefined, new Set())).toBe(true);
    expect(isToolAllowedInContext(undefined, new Set(['subsession', 'scheduled']))).toBe(true);
  });

  test('returns true when capabilities array is empty', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext([], new Set(['subsession']))).toBe(true);
  });

  test('returns true when no scope is active', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext(['interactive-user-input'], new Set())).toBe(true);
  });

  test('returns false when a restricted capability is present in subsession scope', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext(['interactive-user-input'], new Set(['subsession']))).toBe(false);
  });

  test('returns false when a restricted capability is present in scheduled scope', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext(['interactive-user-input'], new Set(['scheduled']))).toBe(false);
  });

  test('returns false when any capability is restricted in any active scope', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(
      isToolAllowedInContext(['some-other', 'interactive-user-input'], new Set(['subsession'])),
    ).toBe(false);
  });

  test('returns true for unknown capabilities regardless of scope', async () => {
    const { isToolAllowedInContext } = await import('@capekai/core/execution');
    expect(isToolAllowedInContext(['some-future-capability'], new Set(['subsession', 'scheduled']))).toBe(true);
  });
});

describe('resolveToolExecutionScopes', () => {
  test('returns empty scope set when session is missing', async () => {
    mockSessionLookup({});
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    expect(await resolveToolExecutionScopes('missing', sessionLookup)).toEqual(new Set());
  });

  test('returns empty scope set for a top-level interactive session', async () => {
    mockSessionLookup({
      'top-1': {
        id: 'top-1',
        parentId: null,
        metadata: null,
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Top',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    expect(await resolveToolExecutionScopes('top-1', sessionLookup)).toEqual(new Set());
  });

  test('adds subsession when current session has a parent', async () => {
    mockSessionLookup({
      'parent-1': {
        id: 'parent-1',
        parentId: null,
        metadata: null,
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Parent',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
      'child-1': {
        id: 'child-1',
        parentId: 'parent-1',
        metadata: null,
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Child',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('child-1', sessionLookup);
    expect(scopes.has('subsession')).toBe(true);
    expect(scopes.has('scheduled')).toBe(false);
  });

  test('adds scheduled when root session has metadata.scheduledJobId', async () => {
    mockSessionLookup({
      'sched-1': {
        id: 'sched-1',
        parentId: null,
        metadata: { scheduledJobId: 'job-42' },
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Scheduled',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('sched-1', sessionLookup);
    expect(scopes.has('subsession')).toBe(false);
    expect(scopes.has('scheduled')).toBe(true);
  });

  test('child of a scheduled root receives both subsession and scheduled', async () => {
    mockSessionLookup({
      'sched-1': {
        id: 'sched-1',
        parentId: null,
        metadata: { scheduledJobId: 'job-42' },
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Scheduled',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
      'child-1': {
        id: 'child-1',
        parentId: 'sched-1',
        metadata: null,
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Child',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('child-1', sessionLookup);
    expect(scopes.has('subsession')).toBe(true);
    expect(scopes.has('scheduled')).toBe(true);
  });

  test('does not add scheduled when scheduledJobId is not a string', async () => {
    mockSessionLookup({
      'root-1': {
        id: 'root-1',
        parentId: null,
        metadata: { scheduledJobId: 42 },
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Root',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('root-1', sessionLookup);
    expect(scopes.has('scheduled')).toBe(false);
  });

  test('does not add scheduled when scheduledJobId is empty string', async () => {
    mockSessionLookup({
      'root-1': {
        id: 'root-1',
        parentId: null,
        metadata: { scheduledJobId: '' },
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Root',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('root-1', sessionLookup);
    expect(scopes.has('scheduled')).toBe(false);
  });

  test('handles parent cycle deterministically', async () => {
    const cyc: Session = {
      id: 'a',
      parentId: 'a',
      metadata: null,
      workspaceId: 'ws-1',
      preconfigId: null,
      title: 'Cycle',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      agentName: null,
      tags: [],
      compacting: false,
    };
    mockSessionLookup({ a: cyc });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('a', sessionLookup);
    expect(scopes.has('subsession')).toBe(true);
    expect(scopes.has('scheduled')).toBe(false);
  });

  test('terminates walk when a parent is missing', async () => {
    mockSessionLookup({
      'child-1': {
        id: 'child-1',
        parentId: 'gone',
        metadata: null,
        workspaceId: 'ws-1',
        preconfigId: null,
        title: 'Child',
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        agentName: null,
        tags: [],
        compacting: false,
      },
    });
    const { resolveToolExecutionScopes } = await import('@capekai/core/execution');
    const scopes = await resolveToolExecutionScopes('child-1', sessionLookup);
    expect(scopes.has('subsession')).toBe(true);
    expect(scopes.has('scheduled')).toBe(false);
  });
});
