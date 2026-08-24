import { describe, expect, test } from 'bun:test';
import type { InitResult } from '@/cli/init';
import { runInitCommand, type InitCommandDependencies } from '@/cli/init-command';

const initialization: InitResult = {
  success: true,
  configPath: '/tmp/prokopai/config.json',
  databasePath: '/tmp/prokopai/agent.db',
  toolsPath: '/tmp/prokopai/tools',
  modelsPath: '/tmp/prokopai/models.json',
  preconfigsInstalled: true,
};

function createDependencies(overrides: Partial<InitCommandDependencies> = {}): {
  dependencies: InitCommandDependencies;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      initialize: async () => {
        calls.push('initialize');
        return initialization;
      },
      start: async () => {
        calls.push('start');
        return { success: true, pid: 123 };
      },
      getClientUrl: () => {
        calls.push('get-url');
        return 'http://localhost:8742';
      },
      waitUntilReady: async () => {
        calls.push('wait');
        return true;
      },
      open: () => {
        calls.push('open');
        return { opened: true, url: 'http://localhost:8742' };
      },
      ...overrides,
    },
  };
}

describe('runInitCommand', () => {
  test('initializes, starts the daemon, and opens the client in order', async () => {
    const { dependencies, calls } = createDependencies();

    const result = await runInitCommand({}, dependencies);

    expect(result.success).toBe(true);
    expect(result.browser?.url).toBe('http://localhost:8742');
    expect(calls).toEqual(['initialize', 'start', 'get-url', 'wait', 'open']);
  });

  test('does not start or open when setup fails', async () => {
    const { dependencies, calls } = createDependencies({
      initialize: async () => {
        calls.push('initialize');
        return { ...initialization, success: false, error: 'already initialized' };
      },
    });

    const result = await runInitCommand({}, dependencies);

    expect(result.success).toBe(false);
    expect(result.error).toBe('already initialized');
    expect(calls).toEqual(['initialize']);
  });

  test('does not check or open the client when daemon startup fails', async () => {
    const { dependencies, calls } = createDependencies({
      start: async () => {
        calls.push('start');
        return { success: false, error: 'spawn failed' };
      },
    });

    const result = await runInitCommand({}, dependencies);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Setup completed, but the daemon did not start: spawn failed');
    expect(calls).toEqual(['initialize', 'start']);
  });

  test('does not open the browser before the client is ready', async () => {
    const { dependencies, calls } = createDependencies({
      waitUntilReady: async () => {
        calls.push('wait');
        return false;
      },
    });

    const result = await runInitCommand({}, dependencies);

    expect(result.success).toBe(false);
    expect(result.error).toBe('The daemon started, but the client did not become ready at http://localhost:8742');
    expect(calls).toEqual(['initialize', 'start', 'get-url', 'wait']);
  });
});
