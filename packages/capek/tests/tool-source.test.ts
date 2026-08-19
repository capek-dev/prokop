import { afterEach, describe, expect, test } from 'bun:test';
import {
  configureWorkspaceToolDiscovery,
  discoverWorkspaceTools,
  getWorkspaceToolDiscovery,
  initializeWorkspaceDiscovery,
} from '../src/tools/tool-source';

afterEach(() => configureWorkspaceToolDiscovery());

describe('workspace tool discovery', () => {
  test('defaults to no-op initialization and no tools', async () => {
    await expect(initializeWorkspaceDiscovery('/workspace')).resolves.toBeUndefined();
    await expect(discoverWorkspaceTools('/workspace', 'session-1')).resolves.toEqual({});
  });

  test('delegates configured discovery calls with exact arguments', async () => {
    const calls: unknown[][] = [];
    const tools = { example: {} as never };
    configureWorkspaceToolDiscovery({
      async initializeWorkspace(path) {
        calls.push(['initialize', path]);
      },
      async discoverTools(path, sessionId) {
        calls.push(['discover', path, sessionId]);
        return tools;
      },
    });

    await initializeWorkspaceDiscovery('/workspace');
    expect(await discoverWorkspaceTools('/workspace', 'session-1')).toBe(tools);
    expect(calls).toEqual([
      ['initialize', '/workspace'],
      ['discover', '/workspace', 'session-1'],
    ]);
    expect(getWorkspaceToolDiscovery().discoverTools).toBeDefined();
  });
});
