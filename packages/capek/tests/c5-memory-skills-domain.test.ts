/**
 * C5 memory and skills domain slice characterization.
 *
 * Pins the memory and skills domain plugin ownership: the agent-scoped
 * `capek.memory-domain` and `capek.skills-domain` services with their tool
 * payloads (`memory`, `agent_memory`, `skill`, `skill_manage`,
 * `agent_skill_manage`), the moved context sections, the workspace settings
 * gates, the build-time allowed-skills and agent-skills-directory capture,
 * the composed no-global-fallback behavior, and the explicit unscoped
 * fallback path.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Workspace } from '@capekai/types';
import { buildAiSdkTools } from '../src/core/build-tools';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import { enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import {
  CURRENT_MEMORY_DOMAIN_PLUGIN_ID,
  capekMemoryDomainKey,
  installMemoryToolFallback,
} from '../src/plugins/memory-domain';
import {
  CURRENT_SKILLS_DOMAIN_PLUGIN_ID,
  capekSkillsDomainKey,
  installSkillsToolFallback,
} from '../src/plugins/skills-domain';
import { resetDomainToolFallbacksForTests } from '../src/runtime/domain-tool-source';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { configureStorage, createInMemoryStorageBundle } from '../src/storage';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';
import { MEMORY_GUIDANCE } from '../src/memory';
import { SKILL_MANAGE_GUIDANCE } from '../src/skills';

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c5-memory-skills-${label}-`));
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
        tempDir: '/tmp/capek-c5-memory-skills-test',
        getEnvironmentValue: () => undefined,
      }),
    },
    sandbox: { isSandboxActive: () => false },
  };
}

function workspaceWith(enabled: { memory: boolean; skillsManage: boolean }, id = 'ws-ms'): Workspace {
  return {
    id,
    name: 'Memory skills workspace',
    path: '/workspace/memory-skills',
    isVirtual: false,
    additionalPaths: [],
    settings: {
      autoApproveSeverity: 'low',
      memory: { enabled: enabled.memory, permissionRisk: 'none' },
      skills: { managementEnabled: enabled.skillsManage, permissionRisk: 'low' },
      sessionSearch: { enabled: false, permissionRisk: 'none', includeToolResults: false },
      workflow: { enabled: false },
      scheduling: { enabled: false, permissionRisk: 'none' },
    },
    createdAt: '',
    updatedAt: '',
  };
}

function configureEnvironment(): void {
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource();
  configureAgentSource();
  configureInstructionSource();
  configureWorkspaceToolDiscovery();
  installMemoryToolFallback();
  installSkillsToolFallback();
}

afterEach(async () => {
  configureEnvironment();
  resetDomainToolFallbacksForTests();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('C5 memory and skills composed scope ownership', () => {
  beforeEach(() => configureEnvironment());

  test('the current composition installs both services with their payload sets and contribution ids', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const memory = agentScope.require(capekMemoryDomainKey);
      const skills = agentScope.require(capekSkillsDomainKey);
      expect(memory.tools.map((tool) => tool.name)).toEqual(['memory', 'agent_memory']);
      expect(skills.tools.map((tool) => tool.name)).toEqual(['skill', 'skill_manage', 'agent_skill_manage']);

      const tools = agentScope.listTools();
      const byName = new Map(tools.map((tool) => [tool.definition.name, tool]));
      expect(byName.get('memory')?.pluginId).toBe(CURRENT_MEMORY_DOMAIN_PLUGIN_ID);
      expect(byName.get('agent_memory')?.pluginId).toBe(CURRENT_MEMORY_DOMAIN_PLUGIN_ID);
      expect(byName.get('skill')?.pluginId).toBe(CURRENT_SKILLS_DOMAIN_PLUGIN_ID);
      expect(byName.get('skill_manage')?.pluginId).toBe(CURRENT_SKILLS_DOMAIN_PLUGIN_ID);
      expect(byName.get('agent_skill_manage')?.pluginId).toBe(CURRENT_SKILLS_DOMAIN_PLUGIN_ID);
      expect(byName.get('memory')?.definition.timeout).toBe(10000);
      expect(byName.get('skill')?.definition.timeout).toBe(5000);
      expect(byName.get('skill_manage')?.definition.timeout).toBe(10000);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed memory tool and context sections use the scope-captured storage and workspace settings, never module globals', async () => {
    const scopeStorage = createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: true, skillsManage: false })] });
    configureStorage(scopeStorage);
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);

    // Reconfigure the module-level storage with a DECOY workspace whose
    // memory is disabled after composition; the composed scope must keep
    // using its captured storage.
    const decoyStorage = createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: false, skillsManage: false })] });
    configureStorage(decoyStorage);

    const workspacePath = join(await tempDir('scoped'), 'workspace');
    await mkdir(join(workspacePath, '.capek'), { recursive: true });

    try {
      const tools = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath,
        workspaceId: 'ws-ms',
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: null,
        agentId: null,
      }));
      expect(Object.keys(tools)).toEqual(['memory', 'retrieve-tool-output']);
      expect(tools).not.toHaveProperty('skill_manage');

      // Context section ownership is pinned through the contribution
      // inventory (the buildContext result carries content only).
      const owned = agentScope.listContextSections();
      expect(owned.find((section) => section.id === 'memory-guidance')?.pluginId)
        .toBe(CURRENT_MEMORY_DOMAIN_PLUGIN_ID);
      expect(owned.find((section) => section.id === 'skill-management-guidance')?.pluginId)
        .toBe(CURRENT_SKILLS_DOMAIN_PLUGIN_ID);

      const sections = await agentScope.buildContext({
        preconfig: { id: 'primary', name: 'P', systemPrompt: 'PROMPT', tools: [], model: null, provider: null, settings: null, isDefault: false } as never,
        workspacePath,
        workspaceId: 'ws-ms',
        additionalPaths: [],
      });
      const memoryGuidance = sections.find((section) => section.id === 'memory-guidance');
      expect(memoryGuidance?.content).toBe(MEMORY_GUIDANCE);
      // The scope storage has skills management disabled, so the
      // skill-management guidance provides null and is omitted.
      expect(sections.find((section) => section.id === 'skill-management-guidance')).toBeUndefined();
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the workspace settings gates stay in the builders for the composed path', async () => {
    const workspacePath = join(await tempDir('gates'), 'workspace');
    await mkdir(join(workspacePath, '.capek'), { recursive: true });
    await mkdir(join(workspacePath, '.agents', 'skills'), { recursive: true });
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: false, skillsManage: false })] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const disabled = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath,
        workspaceId: 'ws-ms',
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: null,
        agentId: null,
      }));
      expect(Object.keys(disabled)).toEqual(['retrieve-tool-output']);

      configureStorage(createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: true, skillsManage: true })] }));
      const scope2Process = await createCurrentProcessScope();
      const scope2 = await createCurrentAgentScope(scope2Process);
      try {
        const enabled = await enterAgentScope(scope2, () => buildAiSdkTools({
          toolNames: [],
          workspacePath,
          workspaceId: 'ws-ms',
          sessionId: 'root',
          canSpawnSubagents: true,
          allowedSkills: null,
          agentId: null,
        }));
        // skill needs at least one available skill; none seeded, so it is
        // omitted exactly like pre-C5.
        expect(Object.keys(enabled)).toEqual(['memory', 'skill_manage', 'retrieve-tool-output']);
      } finally {
        await scope2.dispose();
        await scope2Process.dispose();
      }
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed skill definition respects allowedSkills exactly like pre-C5', async () => {
    const workspacePath = join(await tempDir('allowed'), 'workspace');
    const skillDir = join(workspacePath, '.agents', 'skills', 'demo');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nbody\n');
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: false, skillsManage: true })] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const allowed = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath,
        workspaceId: 'ws-ms',
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: ['demo'],
        agentId: null,
      }));
      expect(Object.keys(allowed)).toEqual(['skill', 'skill_manage', 'retrieve-tool-output']);
      const description = String((allowed.skill as { description?: string })?.description ?? '');
      expect(description).toContain('- **demo**: Demo skill');

      const filtered = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath,
        workspaceId: 'ws-ms',
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: ['other'],
        agentId: null,
      }));
      expect(Object.keys(filtered)).toEqual(['skill_manage', 'retrieve-tool-output']);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the composed agent memory and agent skill tools read only the captured agent directory', async () => {
    const agentDir = join(await tempDir('agent'), 'agent');
    await mkdir(join(agentDir, 'skills'), { recursive: true });
    configureAgentSource({
      getDirectory: async (id) => (id === 'agent-x' ? agentDir : null),
      readMemoryFile: async () => null,
    });

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath: undefined,
        workspaceId: undefined,
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: null,
        agentId: 'agent-x',
      }));
      // No subagent preconfigs are configured in this fixture, so the task
      // tool's dynamic definition resolves to null and it is omitted;
      // agent_memory and agent_skill_manage still build from the agent
      // directory exactly like pre-C5.
      expect(Object.keys(tools)).toEqual(['agent_memory', 'agent_skill_manage', 'retrieve-tool-output']);

      const memoryResult = await tools['agent_memory']!.execute!(
        { action: 'add', target: 'memory', content: 'lesson' },
        { toolCallId: 'tc-1' } as never,
      );
      expect(memoryResult).toMatchObject({ title: 'Agent memory updated' });
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('the explicitly installed fallbacks keep the unscoped memory and skills tools byte-compatible', async () => {
    const workspacePath = join(await tempDir('fallback'), 'workspace');
    await mkdir(join(workspacePath, '.capek'), { recursive: true });
    const skillDir = join(workspacePath, '.agents', 'skills', 'demo');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: demo\ndescription: Demo skill\n---\nbody\n');
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: true, skillsManage: true })] }));

    const enabled = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-ms',
      sessionId: 'root',
      canSpawnSubagents: true,
      allowedSkills: ['demo'],
      agentId: null,
    });
    expect(Object.keys(enabled)).toEqual(['skill', 'memory', 'skill_manage', 'retrieve-tool-output']);

    resetDomainToolFallbacksForTests();
    const cleared = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-ms',
      sessionId: 'root',
      canSpawnSubagents: true,
      allowedSkills: ['demo'],
      agentId: null,
    });
    expect(Object.keys(cleared)).toEqual(['retrieve-tool-output']);

    installMemoryToolFallback();
    installSkillsToolFallback();
    const restored = await buildAiSdkTools({
      toolNames: [],
      workspacePath,
      workspaceId: 'ws-ms',
      sessionId: 'root',
      canSpawnSubagents: true,
      allowedSkills: ['demo'],
      agentId: null,
    });
    expect(Object.keys(restored)).toEqual(['skill', 'memory', 'skill_manage', 'retrieve-tool-output']);

    const guidance = SKILL_MANAGE_GUIDANCE;
    expect(guidance).toContain('skill_manage');
  });

  test('the composed memory tool executes against the workspace path captured by the builder', async () => {
    const workspacePath = join(await tempDir('execute'), 'workspace');
    await mkdir(join(workspacePath, '.capek'), { recursive: true });
    configureStorage(createInMemoryStorageBundle({ workspaces: [workspaceWith({ memory: true, skillsManage: false })] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const tools = await enterAgentScope(agentScope, () => buildAiSdkTools({
        toolNames: [],
        workspacePath,
        workspaceId: 'ws-ms',
        sessionId: 'root',
        canSpawnSubagents: true,
        allowedSkills: null,
        agentId: null,
        broadcastFn: () => {},
      }));
      const result = await tools['memory']!.execute!(
        { action: 'add', target: 'memory', content: 'a workspace fact' },
        { toolCallId: 'tc-1' } as never,
      );
      expect(result).toMatchObject({ title: 'Memory updated' });
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(workspacePath, '.capek', 'MEMORY.md'), 'utf-8');
      expect(content).toContain('a workspace fact');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});
