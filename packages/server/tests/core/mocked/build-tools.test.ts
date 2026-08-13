import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { tool, jsonSchema } from 'ai';
import {
  setJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
} from '@capekai/core/compat/jean2';
import { jean2CompatibilityBindings } from '@/capek-adapter';
import { buildAiSdkTools, type BuildToolsOptions } from '@/core/build-tools';
import { clearCache, scanTools } from '@/tools/registry';
import type { Preconfig, Session, Workspace } from '@jean2/sdk';

interface BindingOverrides {
  sessions?: Record<string, Partial<Session>>;
  sessionNotFound?: boolean;
  subagentPreconfigs?: Preconfig[];
  mcpTools?: Record<string, import('ai').Tool>;
  skillTool?: { name: string; tool: import('ai').Tool } | null;
  workspace?: Workspace | null;
}

let fixtureDir: string | null = null;

function configureBindings(overrides: BindingOverrides = {}): void {
  const bindings: Jean2CompatibilityBindings = {
    ...jean2CompatibilityBindings,
    store: {
      ...jean2CompatibilityBindings.store,
      getSession: (id) => {
        if (overrides.sessionNotFound) return null;
        const session = overrides.sessions?.[id];
        return session
          ? { id, parentId: null, metadata: null, ...session } as Session
          : { id, parentId: null, metadata: null } as Session;
      },
      getWorkspace: () => overrides.workspace ?? null,
    },
    config: {
      ...jean2CompatibilityBindings.config,
      listPreconfigs: async () => overrides.subagentPreconfigs ?? [],
    },
    mcp: {
      ...jean2CompatibilityBindings.mcp,
      getTools: async () => overrides.mcpTools ?? {},
    },
    skills: {
      ...jean2CompatibilityBindings.skills,
      createSkillTool: async () => overrides.skillTool ?? null,
    },
    agents: {
      ...jean2CompatibilityBindings.agents,
      getAgentDirectory: async () => null,
    },
  };
  setJean2CompatibilityBindings(bindings);
}

async function seedTool(
  name: string,
  options: { capabilities?: string[]; success?: boolean } = {},
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
export async function execute() {
  return ${options.success === false
    ? "{ success: false, error: 'Tool crashed' }"
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
    setJean2CompatibilityBindings(jean2CompatibilityBindings);
  });

  test('returns no tools when no sources are enabled', async () => {
    const tools = await buildAiSdkTools(defaultOptions());
    expect(tools).toEqual({});
  });

  test('loads and executes a real package registry tool', async () => {
    await seedTool('read-file');

    const tools = await buildAiSdkTools(defaultOptions({ toolNames: ['read-file'] }));
    const result = await tools['read-file']!.execute!({}, { toolCallId: 'call-1', messages: [] });

    expect(tools).toHaveProperty('read-file');
    expect(result).toBe('fixture-result');
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

  test('merges host-owned skill and MCP tools through explicit bindings', async () => {
    const skill = tool({
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'skill',
    });
    const mcp = tool({
      inputSchema: jsonSchema({ type: 'object', properties: {} }),
      execute: async () => 'mcp',
    });
    configureBindings({
      workspace,
      skillTool: { name: 'skill', tool: skill },
      mcpTools: { 'mcp-tool': mcp },
    });

    const tools = await buildAiSdkTools(defaultOptions({
      workspaceId: workspace.id,
      workspacePath: workspace.path,
    }));

    expect(tools.skill).toBe(skill);
    expect(tools['mcp-tool']).toBe(mcp);
  });
});
