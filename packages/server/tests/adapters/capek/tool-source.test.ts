import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { getWorkspaceToolDiscovery } from '@capekai/core/tools';

const realBarrel = await import('@capekai/core/tools');
const realConfig = await import('@/config');
const realPaths = await import('@/infrastructure/runtime/paths');

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
const { builtinTools } = await import('@/harnesses/prokop/tools');
const { getBuiltinToolsPort, installBuiltinToolsPort } = await import('@/application/ports/builtin-tools');

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

  test('defers MCP initialization until discovery can resolve the session workspace', async () => {
    expect(Object.keys(adapter.jean2WorkspaceToolDiscovery).sort()).toEqual(['discoverTools', 'initializeWorkspace'].sort());
    await expect(adapter.jean2WorkspaceToolDiscovery.initializeWorkspace!('/unavailable/worktree')).resolves.toBeUndefined();
  });

  test('lists the harness built-ins through the installed port', async () => {
    const previousPort = getBuiltinToolsPort();
    installBuiltinToolsPort({ tools: () => builtinTools });
    try {
      const tools = await adapter.jean2ToolCatalog.listTools();
      const readFile = tools.find((tool) => tool.name === 'read-file');
      expect(readFile).toMatchObject({ source: 'builtin' });
      expect(await adapter.jean2ToolCatalog.getTool('read-file')).toBeDefined();
      // The removed tools stay absent even with the port installed.
      expect(tools.some((tool) => tool.name === 'git-worktree')).toBe(false);
      expect(await adapter.jean2ToolCatalog.getTool('git-worktree')).toBeNull();
    } finally {
      installBuiltinToolsPort(previousPort);
    }
  });

  test('without an installed port the catalog lists no built-in entries', async () => {
    const previousPort = getBuiltinToolsPort();
    installBuiltinToolsPort(null);
    try {
      const tools = await adapter.jean2ToolCatalog.listTools();
      expect(tools.every((tool) => tool.source !== 'builtin')).toBe(true);
    } finally {
      installBuiltinToolsPort(previousPort);
    }
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
