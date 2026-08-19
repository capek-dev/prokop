/**
 * C5 pre-flight characterization.
 *
 * Pins the strongest existing composition boundaries before any optional
 * domain moves: the minimal scope has no optional-domain services, tools,
 * or context contributions and stays isolated beside a simultaneously live
 * current agent scope; the exact current buildAiSdkTools ordering with all
 * optional domains enabled (including external, workspace-gated, MCP, and
 * agent tool placement plus the scheduled-run scheduler omission); and the
 * effective context contribution ids, phases, orders, and owning plugin of
 * the composed current agent scope.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonSchema, tool } from 'ai';
import type { Preconfig, Session, Workspace } from '@capekai/types';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { buildAiSdkTools, type BuildToolsOptions } from '../src/core/build-tools';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { createAgentScope, createProcessScope } from '../src/kernel/kernel';
import { LifecycleError } from '../src/kernel/errors';
import { CURRENT_CONTEXT_SECTION_IDS } from '../src/plugins/context-sections';
import { enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { resetProviders } from '../src/providers/registry';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { resetDomainToolFallbacksForTests } from '../src/runtime/domain-tool-source';
import { installSchedulerToolFallback } from '../src/plugins/scheduler-domain';
import { installSessionSearchToolFallback } from '../src/plugins/session-search-domain';
import { installTaskToolFallback } from '../src/plugins/subagent-domain';
import { installWorkflowToolFallback } from '../src/plugins/workflow-domain';
import { installMemoryToolFallback } from '../src/plugins/memory-domain';
import { installSkillsToolFallback } from '../src/plugins/skills-domain';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import {
  configureSessionSearchHost,
  type SessionSearchHost,
} from '../src/session-search';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { configureStorage, createSession } from '../src/storage/runtime';
import { clearCache, scanTools } from '../src/tools/registry';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c5-${label}-`));
  roots.push(path);
  return path;
}

function minimalHost(): RuntimeHost {
  return {
    interaction: {
      createPendingAsk: async () => 'pending',
      removePendingAsk: async () => {},
      removePendingAsksByToolCallId: async () => {},
      getPermissionRequestByRequestId: async () => null,
      resolvePermissionRequestByRequestId: async () => false,
      expirePermissionRequest: async () => false,
      expireOldPermissionRequests: async () => 0,
      cancelPendingRequestsBySession: async () => 0,
      listPendingAsksBySession: async () => [],
      listPendingAsksByRootSession: async () => [],
      listPendingRequestsByRootSession: async () => [],
      matchGrant: async () => ({ matched: false, grant: null }),
      createGrantFromOptions: async () => null,
      getSessionAutoApproveSeverity: async () => undefined,
      getPermissionTimeoutMs: () => 30 * 60 * 1000,
      notifyPermissionRequired: async () => {},
    },
    delivery: { emit: () => {} },
    titles: {
      isDefaultSessionTitle: () => true,
      hasManualSessionTitle: () => false,
      generateSessionTitle: async () => null,
    },
    workspace: {
      createToolWorkspaceHost: () => ({
        root: '/tmp',
        additionalRoots: undefined,
        allowedRoots: [],
        tempDir: '/tmp/capek-c5-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function minimalSearchHost(): SessionSearchHost {
  return {
    getWorkspace: async () => null,
    getSession: async () => null,
    listWorkspaceSessions: async () => [],
    listAgentSessions: async () => [],
    countSessionMessages: async () => 0,
    searchMessages: async () => [],
    countMessagesBefore: async () => 0,
    countMessagesAfter: async () => 0,
    getLatestMessage: async () => null,
    getMessage: async () => null,
    listMessagesBefore: async () => [],
    listMessagesAfter: async () => [],
    getMessageSummary: async () => null,
  };
}

function minimalSchedulerHost(): SchedulerHost {
  return {
    create: () => {
      throw new Error('not configured');
    },
    get: () => null,
    list: () => [],
    update: () => null,
    delete: () => false,
    trigger: () => {},
  };
}

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource();
  configureAgentSource();
  configureInstructionSource();
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
  configureWorkspaceToolDiscovery();
  // Explicit fallback installation: the unscoped order baseline below needs
  // the session_search, scheduler, task, workflow, memory, and skills tools
  // exactly like the Jean2 bootstrap installs them.
  installSessionSearchToolFallback();
  installSchedulerToolFallback();
  installTaskToolFallback();
  installWorkflowToolFallback();
  installMemoryToolFallback();
  installSkillsToolFallback();
}

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  resetProviders();
  clearCache();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

const preconfig = {
  id: 'agent',
  name: 'Agent',
  systemPrompt: 'PROMPT',
} as Preconfig;

const SUBAGENT_PRECONFIG = {
  id: 'explore',
  name: 'Explore',
  description: 'C5 probe subagent',
  mode: 'subagent',
  model: null,
  provider: null,
  systemPrompt: '',
  tools: [],
  settings: null,
  isDefault: false,
} as Preconfig;

function enabledWorkspace(path: string): Workspace {
  return {
    id: 'ws-c5',
    name: 'C5 workspace',
    path,
    isVirtual: false,
    additionalPaths: [],
    settings: {
      autoApproveSeverity: 'low',
      memory: { enabled: true, permissionRisk: 'low' },
      skills: { managementEnabled: true, permissionRisk: 'low' },
      sessionSearch: { enabled: true, permissionRisk: 'low', includeToolResults: false },
      workflow: { enabled: true },
      scheduling: { enabled: true, permissionRisk: 'none' },
    },
    createdAt: '',
    updatedAt: '',
  };
}

async function seedRegistryTool(root: string, name: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tool.ts'), `
export const definition = {
  name: '${name}',
  description: 'C5 fixture ${name} tool',
  inputSchema: { type: 'object', properties: {} },
};
export async function execute() {
  return { success: true, result: 'fixture-result' };
}
`);
}

async function seedSkill(workspacePath: string): Promise<void> {
  const dir = join(workspacePath, '.agents', 'skills', 'c5-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    '---\nname: c5-skill\ndescription: C5 fixture skill\n---\nskill body\n',
  );
}

async function configureToolOrderFixture(
  workspacePath: string,
  agentDir: string,
  toolsDir: string,
): Promise<void> {
  await seedRegistryTool(toolsDir, 'ext-one');
  await seedRegistryTool(toolsDir, 'ext-two');
  await seedSkill(workspacePath);
  await mkdir(join(agentDir, 'skills'), { recursive: true });

  configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace(workspacePath)] }));
  configureAgentSource({
    getDirectory: async (id) => (id === 'agent-x' ? agentDir : null),
    readMemoryFile: async () => null,
  });
  configurePreconfigSource({
    get: async () => null,
    getDefault: async () => null,
    getForAgent: async () => null,
    list: async () => [SUBAGENT_PRECONFIG],
    listSubagents: async () => [SUBAGENT_PRECONFIG],
  });
  configureWorkspaceToolDiscovery({
    discoverTools: async () => ({
      'mcp-alpha': tool({
        description: 'C5 fixture mcp-alpha',
        inputSchema: jsonSchema({ type: 'object' }),
        execute: async () => 'mcp-alpha-result',
      }),
      'mcp-beta': tool({
        description: 'C5 fixture mcp-beta',
        inputSchema: jsonSchema({ type: 'object' }),
        execute: async () => 'mcp-beta-result',
      }),
    }),
  });
  await scanTools(toolsDir);
}

function scheduledSession(workspaceId: string): Omit<Session, 'createdAt' | 'updatedAt'> {
  return {
    id: 'sched-sess',
    workspaceId,
    preconfigId: null,
    title: null,
    status: 'active',
    metadata: { scheduledJobId: 'job-1' },
    parentId: null,
    agentName: null,
    autoApproveSeverity: 'low',
  };
}

function fullOptions(workspacePath: string, overrides: Partial<BuildToolsOptions> = {}): BuildToolsOptions {
  return {
    toolNames: ['ext-two', 'ext-one'],
    workspacePath,
    workspaceId: 'ws-c5',
    sessionId: 'sess-c5',
    canSpawnSubagents: true,
    allowedSkills: null,
    agentId: 'agent-x',
    ...overrides,
  };
}

describe('C5 minimal composition isolation', () => {
  beforeEach(() => configureEnvironment());

  test('a minimal agent scope composes with no services, tools, or context contributions', async () => {
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, []);
    try {
      expect(processScope.snapshot().services).toEqual([]);
      expect(agentScope.snapshot().services).toEqual([]);
      expect(agentScope.snapshot().tools).toEqual([]);
      expect(agentScope.snapshot().contextSections).toEqual([]);
      expect(agentScope.listTools()).toEqual([]);
      expect(agentScope.listContextSections()).toEqual([]);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a minimal scope stays empty while a full current agent scope is simultaneously live and entered', async () => {
    const currentProcess = await createCurrentProcessScope();
    const currentAgent = await createCurrentAgentScope(currentProcess);
    const minimalProcess = await createProcessScope([]);
    const minimalAgent = await createAgentScope(minimalProcess, []);
    try {
      expect(currentAgent.listTools().map((entry) => entry.definition.name)).toEqual([
        'retrieve-tool-output',
        'task',
        'skill',
        'memory',
        'workflow',
        'skill_manage',
        'session_search',
        'scheduler',
        'agent_memory',
        'agent_skill_manage',
      ]);
      expect(currentAgent.listContextSections().map((section) => section.id)).toEqual([
        ...CURRENT_CONTEXT_SECTION_IDS,
      ]);

      // Optional-domain hosts live at the current process scope; the minimal
      // scope chain has none of them.
      expect(currentProcess.snapshot().services.map((service) => service.keyId)).toEqual([
        'capek.installed-tool-registry',
        'capek.provider-registry',
        'capek.scheduler-host',
        'capek.session-search-host',
      ]);
      expect(minimalProcess.snapshot().services).toEqual([]);

      enterAgentScope(currentAgent, () => {
        expect(minimalAgent.listTools()).toEqual([]);
        expect(minimalAgent.listContextSections()).toEqual([]);
        expect(minimalAgent.snapshot().services).toEqual([]);
        expect(currentAgent.listTools().map((entry) => entry.definition.name)).toEqual([
          'retrieve-tool-output',
          'task',
          'skill',
          'memory',
          'workflow',
          'skill_manage',
          'session_search',
          'scheduler',
          'agent_memory',
          'agent_skill_manage',
        ]);
        expect(currentAgent.listContextSections()).toHaveLength(CURRENT_CONTEXT_SECTION_IDS.length);
      });

      expect(minimalAgent.listTools()).toEqual([]);
      expect(minimalAgent.listContextSections()).toEqual([]);
    } finally {
      await minimalAgent.dispose();
      await minimalProcess.dispose();
      await currentAgent.dispose();
      await currentProcess.dispose();
    }
  });

  test('the minimal scope cannot drive a seeded turn because required services are absent', async () => {
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, []);
    try {
      expect(() => enterAgentScope(agentScope, () => undefined)).toThrow(LifecycleError);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C5 buildAiSdkTools order baseline', () => {
  beforeEach(() => configureEnvironment());

  test('pins the exact order with all optional domains enabled', async () => {
    const root = await tempDir('tool-order');
    const workspacePath = join(root, 'workspace');
    const agentDir = join(root, 'agent');
    const toolsDir = join(root, 'tools');
    await configureToolOrderFixture(workspacePath, agentDir, toolsDir);

    const tools = await buildAiSdkTools(fullOptions(workspacePath));

    // Actual observed order: registry tools in toolNames order, then the
    // subagent task tool, then the workspace-gated tools in fixed builder
    // order, then MCP discovery order, then agent tools, then the unscoped
    // retrieval append.
    expect(Object.keys(tools)).toEqual([
      'ext-two',
      'ext-one',
      'task',
      'skill',
      'memory',
      'workflow',
      'skill_manage',
      'session_search',
      'scheduler',
      'mcp-alpha',
      'mcp-beta',
      'agent_memory',
      'agent_skill_manage',
      'retrieve-tool-output',
    ]);
  });

  test('a scheduled-run session omits only the scheduler tool from the same baseline', async () => {
    const root = await tempDir('scheduled-order');
    const workspacePath = join(root, 'workspace');
    const agentDir = join(root, 'agent');
    const toolsDir = join(root, 'tools');
    await configureToolOrderFixture(workspacePath, agentDir, toolsDir);
    createSession(scheduledSession('ws-c5'));

    const tools = await buildAiSdkTools(
      fullOptions(workspacePath, { sessionId: 'sched-sess' }),
    );

    expect(Object.keys(tools)).toEqual([
      'ext-two',
      'ext-one',
      'task',
      'skill',
      'memory',
      'workflow',
      'skill_manage',
      'session_search',
      'mcp-alpha',
      'mcp-beta',
      'agent_memory',
      'agent_skill_manage',
      'retrieve-tool-output',
    ]);
    expect(tools).not.toHaveProperty('scheduler');
  });
});

describe('C5 context contribution order and provenance', () => {
  beforeEach(() => configureEnvironment());

  test('the composed current agent scope pins exact section ids, phases, orders, and owning plugin', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const listed = agentScope.listContextSections().map((section) => [
        section.id,
        section.phase,
        section.order,
        section.pluginId,
        section.scopeKind,
      ]);
      const expected = [
        ['agent-memory', 'identity', 10],
        ['agent-user-preferences', 'identity', 20],
        ['system-prompt', 'identity', 30],
        ['memory-skills-guidance', 'identity', 40],
        ['self-delegation', 'identity', 50],
        ['instructions', 'instructions', 10],
        ['workspace', 'workspace', 10],
        ['workspace-memory', 'workspace', 20],
        ['memory-guidance', 'workspace', 30],
        ['skill-management-guidance', 'workspace', 40],
        ['session-search-guidance', 'workspace', 50],
      ].map(([id, phase, order]) => [
        id,
        phase,
        order,
        id === 'session-search-guidance'
          ? 'current.session-search-domain'
          : id === 'self-delegation'
            ? 'current.subagent-domain'
            : id === 'skill-management-guidance'
              ? 'current.skills-domain'
              : id === 'agent-memory' || id === 'agent-user-preferences'
                || id === 'memory-skills-guidance' || id === 'workspace-memory'
                || id === 'memory-guidance'
                ? 'current.memory-domain'
                : 'current.context-sections',
        'agent',
      ]);

      expect(listed).toEqual(expected);
      expect(
        agentScope.snapshot().contextSections.map((section) => [
          section.id,
          section.phase,
          section.order,
          section.pluginId,
          section.scopeKind,
        ]),
      ).toEqual(expected);

      // The core context sections stay owned by the context-sections plugin;
      // the optional session-search guidance section is owned by the C5
      // session-search domain plugin, the self-delegation section by the C5
      // subagent domain plugin, the memory sections by the C5 memory domain
      // plugin, and the skill-management guidance by the C5 skills domain
      // plugin, all at agent scope.
      expect(new Set(listed.map((entry) => entry[3] as string))).toEqual(
        new Set([
          'current.context-sections',
          'current.session-search-domain',
          'current.subagent-domain',
          'current.memory-domain',
          'current.skills-domain',
        ]),
      );
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('buildContext provides every section in the pinned order with all optional domains enabled', async () => {
    const root = await tempDir('context');
    const workspacePath = join(root, 'workspace');
    const globalPath = join(root, 'global.md');
    const agentDir = join(root, 'agent');
    await mkdir(join(workspacePath, '.capek'), { recursive: true });
    await writeFile(join(workspacePath, 'AGENTS.md'), 'PROJECT');
    await writeFile(join(workspacePath, '.capek', 'USER.md'), '- USER');
    await writeFile(join(workspacePath, '.capek', 'MEMORY.md'), '- MEMORY');
    await writeFile(globalPath, 'GLOBAL');

    configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace(workspacePath)] }));
    configureAgentSource({
      getDirectory: async () => agentDir,
      readMemoryFile: async (_id, file) => (file === 'USER.md' ? 'AGENT_USER' : 'AGENT_MEMORY'),
    });
    configureInstructionSource({ getGlobalPath: () => globalPath });

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const sections = await agentScope.buildContext({
        preconfig,
        workspacePath,
        workspaceId: 'ws-c5',
        additionalPaths: [],
        selfDelegationAvailable: true,
      });
      expect(sections.map((section) => section.id)).toEqual([...CURRENT_CONTEXT_SECTION_IDS]);
      expect(sections.map((section) => section.phase)).toEqual([
        'identity', 'identity', 'identity', 'identity', 'identity',
        'instructions',
        'workspace', 'workspace', 'workspace', 'workspace', 'workspace',
      ]);
      expect(sections.map((section) => section.content.length > 0)).toEqual(
        CURRENT_CONTEXT_SECTION_IDS.map(() => true),
      );
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });});
