import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getToolSource } from '@capekai/core/compat/jean2';

const realBarrel = await import('@capekai/core/compat/jean2');
const realConfig = await import('@/config');
const realPaths = await import('@/paths');
const realMcp = await import('@/mcp');

const realConfigureToolsPath = realBarrel.configureToolsPath;
const realConfigureToolSource = realBarrel.configureToolSource;

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

mock.module('@/paths', () => ({
  ...realPaths,
  getToolsDir: (): string => '/tools-dir',
}));

mock.module('@capekai/core/compat/jean2', () => ({
  ...realBarrel,
  configureToolsPath: (path?: string): void => {
    configuredPaths.push(path);
  },
}));

const adapter = await import('@/adapters/capek/tool-source');

let savedToolsPathEnv: string | undefined;

describe('Čapek tool source adapter', () => {
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
    realConfigureToolSource();
  });

  test('wraps the exact tool source operations by identity', () => {
    expect(Object.keys(adapter.jean2ToolSource).sort()).toEqual(['discoverTools', 'initializeWorkspace'].sort());
    expect(adapter.jean2ToolSource.initializeWorkspace).toBe(realMcp.initializeWorkspace);
    expect(adapter.jean2ToolSource.discoverTools).toBe(realMcp.getTools);
  });

  test('configures the resolved tools path first and installs the module-level source', () => {
    process.env.JEAN2_TOOLS_PATH = '/env-must-not-win';
    adapter.configureJean2ToolSource();

    expect(configuredPaths).toEqual(['/resolved/tools']);
    expect(getToolSource()).toBe(adapter.jean2ToolSource);
  });

  test('falls back to the environment path when resolution throws', () => {
    resolvedPathError = new Error('resolution unavailable');
    process.env.JEAN2_TOOLS_PATH = '/env/tools';
    adapter.configureJean2ToolSource();

    expect(configuredPaths).toEqual(['/env/tools']);
  });

  test('falls back to the tools directory when resolution throws and the environment is unset', () => {
    resolvedPathError = new Error('resolution unavailable');
    delete process.env.JEAN2_TOOLS_PATH;
    adapter.configureJean2ToolSource();

    expect(configuredPaths).toEqual(['/tools-dir']);
  });
});
