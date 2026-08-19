import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { tool, jsonSchema } from 'ai';
import { configureToolSource } from '@capekai/core/tools';
import { configureAgentSource, configurePreconfigSource } from '@capekai/core/hosts';
import {
  configureStorage,
  type StorageBundle,
} from '@capekai/core/storage';
import { configureJean2Bindings } from '@/adapters/capek/bindings';
import { jean2CompatibilityBindings, jean2StorageBundle } from '@/adapters/capek';
import { buildAiSdkTools, type BuildToolsOptions } from '@capekai/core/execution';
import { clearCache, scanTools } from '@capekai/core/tools';
import type { Preconfig, Session, Workspace } from '@jean2/sdk';

interface BindingOverrides {
  sessions?: Record<string, Partial<Session>>;
  sessionNotFound?: boolean;
  subagentPreconfigs?: Preconfig[];
  mcpTools?: Record<string, import('ai').Tool>;
  workspace?: Workspace | null;
}

let fixtureDir: string | null = null;

function configureBindings(overrides: BindingOverrides = {}): void {
  const storage: StorageBundle = {
    ...jean2StorageBundle,
    conversation: {
      ...jean2StorageBundle.conversation,
      getSession: (id) => {
        if (overrides.sessionNotFound) return null;
        const session = overrides.sessions?.[id];
        return session
          ? { id, parentId: null, metadata: null, ...session } as Session
          : { id, parentId: null, metadata: null } as Session;
      },
    },
    workspaces: {
      ...jean2StorageBundle.workspaces,
      get: () => overrides.workspace ?? null,
    },
  };
  configureStorage(storage);
  configureJean2Bindings();
  configurePreconfigSource({
    get: async () => null,
    getDefault: async () => null,
    getForAgent: async () => null,
    list: async () => overrides.subagentPreconfigs ?? [],
    listSubagents: async () => overrides.subagentPreconfigs ?? [],
  });
  configureAgentSource();
  configureToolSource({
    discoverTools: async () => overrides.mcpTools ?? {},
  });
}

async function seedTool(
  name: string,
  options: { capabilities?: string[]; success?: boolean; inspectContext?: boolean } = {},
): Promise<void> {
  fixtureDir ??= mkdtempSync(join(tmpdir(), 'capek-build-tools-'));
  const toolPath = join(fixtureDir, name);
  mkdirSync(toolPath, { recursive: true });
  writeFileSync(join(toolPath, 'tool.ts'), `
export const definition = {
  name: '${name}',
  description: 'Fixture ${name} tool',
  inputSchema: { type: 'object', properties: {} },
  ${options.capabilities ? `capabilities: ${JSON.stringify(options.capabilities)},` : ''}
};
export async function execute(_input, ctx) {
  return ${options.success === false
    ? "{ success: false, error: 'Tool crashed' }"
    : options.inspectContext
      ? "{ success: true, result: { workspacePath: ctx.workspacePath, allowedPaths: ctx.allowedPaths, tempDir: ctx.fs.tempDir, additionalAllowed: ctx.isWithinWorkspace('/workspace/shared/file.txt'), siblingAllowed: ctx.isWithinWorkspace('/workspace/project-other/file.txt') } }"
      : "{ success: true, result: 'fixture-result' }"};
}
`);
  await scanTools(fixtureDir);
}

function defaultOptions(overrides: Partial<BuildToolsOptions> = {}): BuildToolsOptions {
  return {
    toolNames: [],
    workspacePath: undefined,
    workspaceId: undefined,
    sessionId: 'sess-1',
    modelId: 'gpt-4o',
    providerId: 'openai',
    canSpawnSubagents: false,
    allowedSkills: null,
    broadcastFn: undefined,
    ...overrides,
  };
}

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Workspace',
  path: '/workspace',
  isVirtual: false,
  additionalPaths: [],
  settings: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

describe('build-tools binding integration', () => {
  beforeEach(() => configureBindings());

  afterEach(() => {
    clearCache();
    if (fixtureDir) {
      rmSync(fixtureDir, { recursive: true, force: true });
      fixtureDir = null;
    }
    configureStorage(jean2StorageBundle);
    configureJean2Bindings();
  });

  test('exposes only intrinsic artifact retrieval when no sources are enabled', async () => {
    const tools = await buildAiSdkTools(defaultOptions());
    expect(Object.keys(tools)).toEqual(['retrieve-tool-output']);
  });

  test('keeps intrinsic artifact retrieval callable without preconfig migration', async () => {
    const tools = await buildAiSdkTools(defaultOptions());
    expect(await tools['retrieve-tool-output']!.execute!(
      { artifactId: 'not-a-uuid' },
      { toolCallId: 'call-retrieve', messages: [] },
    )).toEqual({ error: 'Tool output artifact not found' });
  });

  test('loads and executes a real package registry tool', async () => {
    await seedTool('read-file');

    const tools = await buildAiSdkTools(defaultOptions({ toolNames: ['read-file'] }));
    const result = await tools['read-file']!.execute!({}, { toolCallId: 'call-1', messages: [] });

    expect(tools).toHaveProperty('read-file');
    expect(result).toBe('fixture-result');
  });

  test('constructs external tool workspace capabilities through the adapter seam', async () => {
    await seedTool('workspace-context', { inspectContext: true });

    const tools = await buildAiSdkTools(defaultOptions({
      toolNames: ['workspace-context'],
      workspacePath: '/workspace/project',
      additionalPaths: ['/workspace/shared'],
      sessionId: 'session-context',
    }));
    const result = await tools['workspace-context']!.execute!({}, { toolCallId: 'call-context', messages: [] });

    expect(result).toEqual({
      workspacePath: '/workspace/project',
      allowedPaths: [jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        sessionId: 'session-context',
      }).allowedRoots?.[0]],
      tempDir: jean2CompatibilityBindings.workspace.createToolWorkspaceHost({
        sessionId: 'session-context',
      }).tempDir,
      additionalAllowed: true,
      siblingAllowed: false,
    });
  });

  test('returns the existing error object for failed tool execution', async () => {
    await seedTool('write-file', { success: false });

    const tools = await buildAiSdkTools(defaultOptions({ toolNames: ['write-file'] }));
    const result = await tools['write-file']!.execute!({}, { toolCallId: 'call-2', messages: [] });

    expect(result).toEqual({ error: 'Tool crashed' });
  });

  test('discovers subagents through the package-owned policy', async () => {
    configureBindings({
      subagentPreconfigs: [{
        id: 'research',
        name: 'Research',
        description: 'Research tasks',
        mode: 'subagent',
        model: null,
        provider: null,
        systemPrompt: '',
        tools: [],
        settings: null,
        isDefault: false,
      }],
    });

    const tools = await buildAiSdkTools(defaultOptions({ canSpawnSubagents: true }));

    expect(tools).toHaveProperty('task');
  });

  test('filters interactive tools using binding-provided session ancestry', async () => {
    await seedTool('question', { capabilities: ['interactive-user-input'] });
    await seedTool('read-file');
    configureBindings({
      sessions: {
        parent: { parentId: null },
        child: { parentId: 'parent' },
      },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      sessionId: 'child',
      toolNames: ['question', 'read-file'],
    }));

    expect(tools).not.toHaveProperty('question');
    expect(tools).toHaveProperty('read-file');
  });

  test('omits the scheduler tool from scheduled-run sessions', async () => {
    configureBindings({
      sessions: {
        scheduled: { metadata: { scheduledJobId: 'job-1' } },
      },
      workspace: {
        ...workspace,
        settings: { scheduling: { enabled: true, permissionRisk: 'medium' } },
      },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      sessionId: 'scheduled',
    }));

    expect(tools).not.toHaveProperty('scheduler');
  });

  test('merges package-owned skill and host MCP tools through explicit sources', async () => {
    fixtureDir ??= mkdtempSync(join(tmpdir(), 'capek-build-tools-'));
    const workspacePath = join(fixtureDir, 'workspace');
    const skillDir = join(workspacePath, '.agents', 'skills', 'skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: skill\ndescription: Fixture skill\n---\nskill body');
    const mcp = tool({
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'mcp',
    });
    configureBindings({
      workspace: { ...workspace, path: workspacePath },
      mcpTools: { 'mcp-tool': mcp },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      workspaceId: workspace.id,
      workspacePath,
    }));

    expect(tools.skill).toBeDefined();
    expect(tools['mcp-tool']).toBeDefined();
    expect(tools['mcp-tool']).not.toBe(mcp);
    expect(await tools['mcp-tool']!.execute!({}, { toolCallId: 'call-mcp', messages: [] })).toBe('mcp');
  });
});
