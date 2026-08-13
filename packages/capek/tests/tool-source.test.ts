import { afterEach, describe, expect, test } from 'bun:test';
import {
  configureToolSource,
  discoverSourceTools,
  getToolSource,
  initializeToolWorkspace,
} from '../src/tools/tool-source';

afterEach(() => configureToolSource());

describe('tool source lifecycle', () => {
  test('defaults to no-op initialization and no tools', async () => {
    await expect(initializeToolWorkspace('/workspace')).resolves.toBeUndefined();
    await expect(discoverSourceTools('/workspace', 'session-1')).resolves.toEqual({});
  });

  test('delegates configured lifecycle calls with exact arguments', async () => {
    const calls: unknown[][] = [];
    const tools = { example: {} as never };
    configureToolSource({
      async initializeWorkspace(path) {
        calls.push(['initialize', path]);
      },
      async discoverTools(path, sessionId) {
        calls.push(['discover', path, sessionId]);
        return tools;
      },
    });

    await initializeToolWorkspace('/workspace');
    expect(await discoverSourceTools('/workspace', 'session-1')).toBe(tools);
    expect(calls).toEqual([
      ['initialize', '/workspace'],
      ['discover', '/workspace', 'session-1'],
    ]);
    expect(getToolSource().discoverTools).toBeDefined();
  });
});
