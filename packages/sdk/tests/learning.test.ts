import { afterEach, expect, mock, test } from 'bun:test';
import { WorkspacesRestNamespace } from '../src/rest/workspaces';
import { SessionsRestNamespace } from '../src/rest/sessions';
import { HttpClient } from '../src/transport/http';
import { TypedEventEmitter } from '../src/emitter';
import { routeServerMessage, type SdkEventMap } from '../src/types/server-messages';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('learning completion routes to subscribers', () => {
  const emitter = new TypedEventEmitter<SdkEventMap>();
  const handler = mock(() => {});
  emitter.on('learning.changed', handler);
  routeServerMessage(emitter, { type: 'learning.changed', workspaceId: 'ws' });
  expect(handler).toHaveBeenCalledWith('ws');
});

test('learning methods encode identities and carry revision/exclusion bodies', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ success: true });
  }) as typeof fetch;
  const http = new HttpClient({ url: 'https://example.com' });
  const workspaces = new WorkspacesRestNamespace(http);
  await workspaces.learningRuns('ws/1');
  await workspaces.learningRun('ws/1', 'run/1');
  await workspaces.undoLearningChange('ws/1', 'run/1', 'change/1');
  await workspaces.keepLearningFiles('ws/1', 'run/1', 'revision');
  await new SessionsRestNamespace(http).setLearning('session/1', { excluded: true, includeAutomated: false });
  expect(calls.map(c => c.url)).toEqual([
    'https://example.com/api/workspaces/ws%2F1/learning/runs',
    'https://example.com/api/workspaces/ws%2F1/learning/runs/run%2F1',
    'https://example.com/api/workspaces/ws%2F1/learning/runs/run%2F1/changes/change%2F1/undo',
    'https://example.com/api/workspaces/ws%2F1/learning/runs/run%2F1/keep-current',
    'https://example.com/api/sessions/session%2F1/learning',
  ]);
  expect(calls[3]?.body).toEqual({ revision: 'revision' });
  expect(calls[4]?.body).toEqual({ excluded: true, includeAutomated: false });
});
