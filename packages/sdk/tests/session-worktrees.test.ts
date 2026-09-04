import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ClientMessage, ManagedWorktree } from '../src/shared';
import { SessionsNamespace } from '../src/namespaces/sessions';
import { SessionsRestNamespace } from '../src/rest/sessions';
import { WorkspacesRestNamespace } from '../src/rest/workspaces';
import { HttpClient } from '../src/transport/http';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('session worktree SDK contracts', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('exports managed worktree types and sends workspaceRootId on session.create', () => {
    const worktree: ManagedWorktree = {
      id: 'worktree-1',
      name: 'test-worktree',
      workspaceId: 'workspace-1',
      repositoryId: 'repository-1',
      path: '/repo-worktree',
      branch: 'feature/test',
      head: 'abc123',
      state: 'available',
      dirty: false,
      untrackedCount: 0,
      attachments: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let sent: ClientMessage | null = null;
    const sessions = new SessionsNamespace((message) => {
      sent = message;
    });

    sessions.create({
      workspaceId: worktree.workspaceId,
      workspaceRootId: worktree.id,
      preconfigId: 'prokop-code',
    });

    expect(sent).toEqual({
      type: 'session.create',
      workspaceId: 'workspace-1',
      workspaceRootId: 'worktree-1',
      preconfigId: 'prokop-code',
    });
  });

  test('binds a worktree through the typed REST endpoint', async () => {
    let capturedUrl = '';
    let capturedInit = {} as RequestInit;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init ?? {};
      return jsonResponse({ session: { id: 'session-1', workspaceRootId: 'worktree-1' } });
    }) as typeof fetch;
    const sessions = new SessionsRestNamespace(new HttpClient({ url: 'https://example.com' }));

    const result = await sessions.bindWorktree('session/1', 'worktree-1');

    expect(capturedUrl).toBe('https://example.com/api/sessions/session%2F1/worktree');
    expect(capturedInit.method).toBe('PUT');
    expect(JSON.parse(capturedInit.body as string)).toEqual({ worktreeId: 'worktree-1' });
    expect(result.session.workspaceRootId).toBe('worktree-1');
  });

  test('sends workspaceRootId through REST session creation', async () => {
    let capturedInit = {} as RequestInit;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? {};
      return jsonResponse({ session: { id: 'session-1', workspaceRootId: 'worktree-1' } });
    }) as typeof fetch;
    const sessions = new SessionsRestNamespace(new HttpClient({ url: 'https://example.com' }));

    const result = await sessions.create({
      workspaceId: 'workspace-1',
      workspaceRootId: 'worktree-1',
    });

    expect(capturedInit.method).toBe('POST');
    expect(JSON.parse(capturedInit.body as string)).toMatchObject({
      workspaceId: 'workspace-1',
      workspaceRootId: 'worktree-1',
    });
    expect(result.session.workspaceRootId).toBe('worktree-1');
  });

  test('lists worktree source refs through the typed REST endpoint', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        refs: [{
          name: 'feature/available',
          ref: 'refs/heads/feature/available',
          kind: 'local',
          commit: 'abc123',
          current: false,
          checkedOut: false,
        }],
      });
    }) as typeof fetch;
    const workspaces = new WorkspacesRestNamespace(new HttpClient({ url: 'https://example.com' }));

    const result = await workspaces.listWorktreeRefs('workspace/1');

    expect(capturedUrl).toBe('https://example.com/api/workspaces/workspace%2F1/worktree-refs');
    expect(result.refs[0]?.ref).toBe('refs/heads/feature/available');
  });

  test('creates a named worktree from an existing local branch', async () => {
    let capturedInit = {} as RequestInit;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedInit = init ?? {};
      return jsonResponse({ worktree: { id: 'worktree-1', name: 'available-work' } });
    }) as typeof fetch;
    const workspaces = new WorkspacesRestNamespace(new HttpClient({ url: 'https://example.com' }));

    await workspaces.createWorktree('workspace-1', {
      name: 'available-work',
      branch: 'refs/heads/feature/available',
    });

    expect(JSON.parse(capturedInit.body as string)).toEqual({
      name: 'available-work',
      branch: 'refs/heads/feature/available',
    });
  });

  test('unbinds a worktree through the typed REST endpoint', async () => {
    let capturedUrl = '';
    let capturedInit = {} as RequestInit;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init ?? {};
      return jsonResponse({ session: { id: 'session-1', workspaceRootId: null } });
    }) as typeof fetch;
    const sessions = new SessionsRestNamespace(new HttpClient({ url: 'https://example.com' }));

    const result = await sessions.unbindWorktree('session/1');

    expect(capturedUrl).toBe('https://example.com/api/sessions/session%2F1/worktree');
    expect(capturedInit.method).toBe('DELETE');
    expect(result.session.workspaceRootId).toBeNull();
  });
});
