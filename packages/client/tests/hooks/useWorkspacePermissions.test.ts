import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ProkopaiClient, type PermissionGrant } from '@prokopai/sdk';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';

afterEach(() => vi.restoreAllMocks());

function setupClient() {
  const client = new ProkopaiClient({ url: 'http://test.invalid' });
  vi.spyOn(client, 'connected', 'get').mockReturnValue(true);
  const list = vi.spyOn(client.permissions, 'list').mockImplementation(() => {});
  const revoke = vi.spyOn(client.permissions, 'revoke').mockImplementation(() => {});
  const revokeAll = vi.spyOn(client.permissions, 'revokeAll').mockImplementation(() => {});
  return { client, list, revoke, revokeAll };
}
const grant = (id: string) => ({ id, revokedAt: null }) as PermissionGrant;

describe('workspace settings permissions', () => {
  test('isolates late lists and revoke-all events by selected workspace', () => {
    const { client, list, revoke, revokeAll } = setupClient();
    const hook = renderHook(({ id }) => useWorkspacePermissions(client, id), { initialProps: { id: 'a' } });
    expect(list).toHaveBeenLastCalledWith('a', true);
    act(() => { client.emit('permission.list', 'a', [grant('grant-a')]); });
    expect(hook.result.current.permissions).toHaveLength(1);
    hook.rerender({ id: 'b' });
    expect(hook.result.current.permissions).toEqual([]);
    act(() => { client.emit('permission.list', 'a', [grant('late-a')]); });
    expect(hook.result.current.permissions).toEqual([]);
    act(() => { client.emit('permission.list', 'b', [grant('grant-b')]); });
    expect(hook.result.current.permissions[0]?.id).toBe('grant-b');
    hook.result.current.revoke('grant-b');
    expect(revoke).toHaveBeenCalledWith('grant-b');
    hook.result.current.revokeAll();
    expect(revokeAll).toHaveBeenCalledWith('b');
    const count = list.mock.calls.length;
    act(() => { client.emit('permission.all_revoked', 'a', 1); });
    expect(list).toHaveBeenCalledTimes(count);
    act(() => { client.emit('permission.all_revoked', 'b', 1); });
    expect(list).toHaveBeenCalledTimes(count + 1);
    act(() => { client.emit('permission.revoked', 'grant-b'); });
    expect(hook.result.current.permissions[0]?.revokedAt).toBeTruthy();
    act(() => { client.emit('connected'); });
    expect(list).toHaveBeenCalledTimes(count + 2);
    hook.unmount();
    expect(client.listenerCount('permission.list')).toBe(0);
    expect(client.listenerCount('permission.revoked')).toBe(0);
    expect(client.listenerCount('permission.all_revoked')).toBe(0);
    expect(client.listenerCount('connected')).toBe(0);
  });

  test('clears old server results for the same workspace ID', () => {
    const first = setupClient();
    const second = setupClient();
    const hook = renderHook(({ client }) => useWorkspacePermissions(client, 'a'), { initialProps: { client: first.client } });
    act(() => { first.client.emit('permission.list', 'a', [grant('old-server')]); });
    hook.rerender({ client: second.client });
    expect(hook.result.current.permissions).toEqual([]);
    expect(first.client.listenerCount('permission.list')).toBe(0);
    expect(second.list).toHaveBeenCalledWith('a', true);
  });
});
