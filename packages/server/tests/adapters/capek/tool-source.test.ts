import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getWorkspaceToolDiscovery } from '@capekai/core/tools';

const realBarrel = await import('@capekai/core/tools');
const realConfig = await import('@/config');
const realPaths = await import('@/infrastructure/runtime/paths');
const realMcp = await import('@/infrastructure/mcp');

const realConfigureToolsPath = realBarrel.configureToolsPath;
const realConfigureWorkspaceToolDiscovery = realBarrel.configureWorkspaceToolDiscovery;

let resolvedToolsPath = '/resolved/tools';
let resolvedPathError: Error | null = null;
const configuredPaths: (string | undefined)[] = [];

// File-scoped module mocks. Every other export is the real implementation, so
// unrelated module consumers keep their original behavior.
mock.module('@/config', () => ({
  ...realConfig,
  resolveToolsPath: (): string => {
    if (resolvedPathError) throw resolvedPathError;
    return resolvedToolsPath;
  },
}));

mock.module('@/infrastructure/runtime/paths', () => ({
  ...realPaths,
  getToolsDir: (): string => '/tools-dir',
}));

mock.module('@capekai/core/tools', () => ({
  ...realBarrel,
  configureToolsPath: (path?: string): void => {
    configuredPaths.push(path);
  },
}));

const adapter = await import('@/adapters/capek/tool-source');

let savedToolsPathEnv: string | undefined;

describe('Čapek workspace tool discovery adapter', () => {
  beforeEach(() => {
    configuredPaths.length = 0;
    resolvedToolsPath = '/resolved/tools';
    resolvedPathError = null;
    savedToolsPathEnv = process.env.JEAN2_TOOLS_PATH;
  });

  afterEach(() => {
    if (savedToolsPathEnv === undefined) delete process.env.JEAN2_TOOLS_PATH;
    else process.env.JEAN2_TOOLS_PATH = savedToolsPathEnv;
    realConfigureToolsPath();
    realConfigureWorkspaceToolDiscovery();
  });

  test('wraps the exact workspace tool discovery operations by identity', () => {
    expect(Object.keys(adapter.jean2WorkspaceToolDiscovery).sort()).toEqual(['discoverTools', 'initializeWorkspace'].sort());
    expect(adapter.jean2WorkspaceToolDiscovery.initializeWorkspace).toBe(realMcp.initializeWorkspace);
    expect(adapter.jean2WorkspaceToolDiscovery.discoverTools).toBe(realMcp.getTools);
  });

  test('configures the resolved tools path first and installs the module-level discovery', () => {
    process.env.JEAN2_TOOLS_PATH = '/env-must-not-win';
    adapter.configureJean2WorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/resolved/tools']);
    expect(getWorkspaceToolDiscovery()).toBe(adapter.jean2WorkspaceToolDiscovery);
  });

  test('falls back to the environment path when resolution throws', () => {
    resolvedPathError = new Error('resolution unavailable');
    process.env.JEAN2_TOOLS_PATH = '/env/tools';
    adapter.configureJean2WorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/env/tools']);
  });

  test('falls back to the tools directory when resolution throws and the environment is unset', () => {
    resolvedPathError = new Error('resolution unavailable');
    delete process.env.JEAN2_TOOLS_PATH;
    adapter.configureJean2WorkspaceToolDiscovery();

    expect(configuredPaths).toEqual(['/tools-dir']);
  });
});
