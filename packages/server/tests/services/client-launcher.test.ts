import { describe, expect, mock, test } from 'bun:test';

import {
  prepareAndLaunchClient,
  type ClientLauncher,
  type LaunchResult,
} from '@/infrastructure/runtime/client-launcher';

function createLauncher(overrides: Partial<ClientLauncher> = {}): ClientLauncher {
  return {
    ensureInstalled: mock(async () => '1.0.0'),
    checkForUpdate: mock(async () => null),
    installUpdate: mock(async () => '1.1.0'),
    launch: mock(async (): Promise<LaunchResult> => ({
      success: true,
      port: 3774,
      url: 'http://localhost:3774',
    })),
    stop: mock(() => {}),
    isRunning: mock(() => false),
    getInstalledVersion: mock(() => '1.0.0'),
    ...overrides,
  };
}

describe('client startup orchestration', () => {
  test('checks and installs an update before launching once', async () => {
    const calls: string[] = [];
    const launcher = createLauncher({
      ensureInstalled: mock(async () => {
        calls.push('ensure');
        return '1.0.0';
      }),
      checkForUpdate: mock(async () => {
        calls.push('check');
        return '1.1.0';
      }),
      installUpdate: mock(async () => {
        calls.push('install');
        return '1.1.0';
      }),
      launch: mock(async () => {
        calls.push('launch');
        return { success: true, port: 3774, url: 'http://localhost:3774' };
      }),
      getInstalledVersion: mock(() => '1.1.0'),
    });

    const result = await prepareAndLaunchClient(launcher, 3774, 3000, 'localhost');

    expect(calls).toEqual(['ensure', 'check', 'install', 'launch']);
    expect(result.version).toBe('1.1.0');
  });

  test('launches the installed version when the update check fails', async () => {
    const launch = mock(async (): Promise<LaunchResult> => ({
      success: true,
      port: 3774,
      url: 'http://localhost:3774',
    }));
    const launcher = createLauncher({
      checkForUpdate: mock(async () => {
        throw new Error('offline');
      }),
      launch,
    });

    const result = await prepareAndLaunchClient(launcher, 3774, 3000, 'localhost');

    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.version).toBe('1.0.0');
  });

  test('does not report a failed update as installed', async () => {
    const launch = mock(async (): Promise<LaunchResult> => ({
      success: true,
      port: 3774,
      url: 'http://localhost:3774',
    }));
    const launcher = createLauncher({
      checkForUpdate: mock(async () => '1.1.0'),
      installUpdate: mock(async () => {
        throw new Error('install failed');
      }),
      launch,
      getInstalledVersion: mock(() => '1.0.0'),
    });

    const result = await prepareAndLaunchClient(launcher, 3774, 3000, 'localhost');

    expect(launch).toHaveBeenCalledTimes(1);
    expect(result.version).toBe('1.0.0');
  });
});
