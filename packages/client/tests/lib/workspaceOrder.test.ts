import { beforeEach, expect, test } from 'vitest';
import type { ProkopaiClient, Workspace } from '@prokopai/sdk';
import { loadWorkspaceOrder, sortWorkspaces, WORKSPACE_ORDER_KEY } from '@/lib/workspaceOrder';
import { refreshWorkspaceActivity } from '@/lib/refreshWorkspaceActivity';
import { handleWorkspaceActivity } from '@/handlers/serverMessage/workspaceActivity';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useUIStore } from '@/stores/uiStore';

const workspace = (id: string, name: string, day: number, activity?: number): Workspace => ({
  id, name, path: '/', isVirtual: false, additionalPaths: [], settings: {},
  createdAt: `2025-01-0${day}T00:00:00Z`, updatedAt: '', lastConversationAt: activity,
});
const items = [workspace('a', 'Zulu', 1, 300), workspace('b', 'alpha', 2, 100), workspace('c', 'Beta', 3)];
beforeEach(() => {
  localStorage.clear();
  useServerDataStore.setState({ serverId: 'server', workspaces: items, activeWorkspace: items[0] });
  useUIStore.setState({ workspaceOrder: 'newest' });
});

test('all five orders are deterministic and do not mutate input', () => {
  const ids = (order: Parameters<typeof sortWorkspaces>[2]) => sortWorkspaces(items, [], order).map(w => w.id);
  expect(ids('name-asc')).toEqual(['b', 'c', 'a']);
  expect(ids('name-desc')).toEqual(['a', 'c', 'b']);
  expect(ids('newest')).toEqual(['c', 'b', 'a']);
  expect(ids('oldest')).toEqual(['a', 'b', 'c']);
  expect(ids('active')).toEqual(['a', 'b', 'c']);
  expect(items.map(w => w.id)).toEqual(['a', 'b', 'c']);
});

test('preference persists with a safe default for malformed values', () => {
  expect(loadWorkspaceOrder()).toBe('newest');
  useUIStore.getState().setWorkspaceOrder('active');
  expect(loadWorkspaceOrder()).toBe('active');
  localStorage.setItem(WORKSPACE_ORDER_KEY, 'invalid');
  expect(loadWorkspaceOrder()).toBe('newest');
});

test('activity patches the active workspace, permits deletion resets and rejects malformed input', () => {
  handleWorkspaceActivity('a', 500);
  expect(useServerDataStore.getState().activeWorkspace?.lastConversationAt).toBe(500);
  for (const value of [undefined, '600', NaN, Infinity, -1]) handleWorkspaceActivity('a', value);
  expect(useServerDataStore.getState().workspaces[0].lastConversationAt).toBe(500);
  handleWorkspaceActivity('a', null);
  expect(useServerDataStore.getState().activeWorkspace?.lastConversationAt).toBeNull();
});

test('reconnect refresh preserves incoming events and refreshes untouched activity', async () => {
  let resolve!: (value: { workspaces: Workspace[] }) => void;
  const client = { http: { workspaces: { list: () => new Promise(r => { resolve = r; }) } } } as unknown as ProkopaiClient;
  const pending = refreshWorkspaceActivity(client, () => true);
  handleWorkspaceActivity('a', 900);
  resolve({ workspaces: [workspace('a', 'Zulu', 1, 400), workspace('b', 'alpha', 2, 600)] });
  await pending;
  expect(useServerDataStore.getState().workspaces.map(w => w.lastConversationAt)).toEqual([900, 600, undefined]);
});

test('retired connection cannot apply its refresh', async () => {
  const client = { http: { workspaces: { list: async () => ({ workspaces: [workspace('a', 'Zulu', 1, 999)] }) } } } as unknown as ProkopaiClient;
  await refreshWorkspaceActivity(client, () => false);
  expect(useServerDataStore.getState().workspaces[0].lastConversationAt).toBe(300);
});
