/**
 * C3 ordered context contributions.
 *
 * Pins byte-exact ordered assembly against the fixed legacy builder, the
 * literal golden output with all sections, omission variants, empty-prompt
 * artifacts, duplicate-id and malformed-data failures, typed data
 * passthrough, facade real-run parity, and two-agent interleaved isolation.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Preconfig, Workspace } from '@capekai/types';
import { createDefaultRuntimeConfiguration } from '../src/configuration/defaults';
import { configureRuntimeConfiguration } from '../src/configuration/runtime';
import {
  ContextAssemblyDataError,
  getContextAssembler,
  setDefaultContextAssembler,
  withContextAssembler,
  type ContextAssemblyData,
} from '../src/context/assembler';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
} from '../src/context/sources';
import { DuplicateContributionError, LifecycleError, MalformedPluginError } from '../src/kernel/errors';
import { createAgentScope, createProcessScope } from '../src/kernel/kernel';
import type { CapekPlugin, PluginContext } from '../src/kernel/types';
import { createComposition, enterAgentScope } from '../src/plugins/compose';
import { createCurrentAgentScope, createCurrentProcessScope } from './helpers/composition';
import { StandaloneAgent } from './helpers/standalone-agent';
import {
  createContextSectionsPlugin,
  createOrderedContextAssembler,
  CURRENT_CONTEXT_SECTION_IDS,
} from '../src/plugins/context-sections';
import { buildSystemMessage, fixedBuilderContextAssembler } from '../src/plugins/legacy-system-message';
import { capekContextAssemblerKey } from '../src/plugins/service-keys';
import { resetProviders } from '../src/providers/registry';
import { configureRuntimeHost, type RuntimeHost } from '../src/runtime/host';
import { SandboxController } from '../src/sandbox/controller';
import type { SandboxControlEvent, SandboxHistoryEntry } from '../src/sandbox/types';
import { configureSchedulerHost, type SchedulerHost } from '../src/scheduler/host';
import { configureSessionSearchHost, type SessionSearchHost } from '../src/session-search/host';
import { createInMemoryStorageBundle } from '../src/storage/memory';
import { configureStorage } from '../src/storage/runtime';
import { configureWorkspaceToolDiscovery } from '../src/tools/tool-source';

const roots: string[] = [];

async function workspace(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `capek-c3-${label}-`));
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
        tempDir: '/tmp/capek-test',
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
  setDefaultContextAssembler(fixedBuilderContextAssembler);
  configureStorage(createInMemoryStorageBundle());
  configureRuntimeConfiguration();
  configureRuntimeHost(minimalHost());
  configurePreconfigSource();
  configureAgentSource();
  configureInstructionSource();
  configureSessionSearchHost(minimalSearchHost());
  configureSchedulerHost(minimalSchedulerHost());
  configureWorkspaceToolDiscovery();
}

afterEach(async () => {
  configureEnvironment();
  resetProviders();
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

const preconfig = {
  id: 'agent',
  name: 'Agent',
  systemPrompt: 'PROMPT',
} as Preconfig;

const enabledWorkspace = (id: string): Workspace => ({
  id,
  name: 'Workspace',
  path: '/workspace',
  isVirtual: false,
  additionalPaths: [],
  settings: {
    autoApproveSeverity: 'low',
    memory: { enabled: true, permissionRisk: 'low' },
    skills: { managementEnabled: true, permissionRisk: 'low' },
    sessionSearch: { enabled: true, permissionRisk: 'low', includeToolResults: false },
  },
  createdAt: '',
  updatedAt: '',
});

async function configureFullSources(
  workspacePath: string,
  globalPath: string,
): Promise<void> {
  configureAgentSource({
    getDirectory: async () => '/agents/agent',
    readMemoryFile: async (_id, file) => (file === 'USER.md' ? 'AGENT_USER' : 'AGENT_MEMORY'),
  });
  configureInstructionSource({ getGlobalPath: () => globalPath });
  await mkdir(join(workspacePath, '.capek'), { recursive: true });
  await writeFile(join(workspacePath, '.capek', 'USER.md'), '- WORKSPACE_USER');
  await writeFile(join(workspacePath, '.capek', 'MEMORY.md'), '- WORKSPACE_MEMORY');
  await writeFile(join(workspacePath, 'AGENTS.md'), 'PROJECT');
}

const AGENT_MEMORY_SECTION = '<agent_memory>\nAGENT_MEMORY\n</agent_memory>';
const AGENT_USER_SECTION = '<agent_user_preferences>\nAGENT_USER\n</agent_user_preferences>';
const AGENT_MEMORY_SKILLS_GUIDANCE = `You have personal memory and skills that travel with you across all workspaces.

MEMORY:
- Use "memory" (workspace) for facts about THIS project (repo conventions, build commands, project-specific patterns).
- Use "agent_memory" (personal) for cross-project knowledge: reusable patterns, techniques, pitfalls, and user preferences that apply everywhere.
- Save to agent_memory when: you complete a complex multi-step task, the user corrects your approach, you discover a pattern useful beyond this project, or you debug through errors.

SKILLS:
- Use "skill_manage" for procedures specific to THIS workspace.
- Use "agent_skill_manage" for personal workflows you've refined across projects.

Before saving, use list to check existing entries and avoid duplicates.`;
const SELF_DELEGATION_SECTION = `SELF-DELEGATION:
- You may use the task tool with subagent_type "agent" to delegate work to a fresh instance of yourself.
- This permission applies only to the immediate child. Reusing "agent" later in the same ancestry chain is blocked.`;
const INSTRUCTIONS_SECTION = '<instructions source="global">\nGLOBAL\n</instructions>\n\n<instructions source="project">\nPROJECT\n</instructions>';
const WORKSPACE_MEMORY_SECTION = '<user_memory path="USER.md" usage="16/1500">\n- WORKSPACE_USER\n</user_memory>\n\n<workspace_memory path="MEMORY.md" usage="18/2500">\n- WORKSPACE_MEMORY\n</workspace_memory>';
const MEMORY_GUIDANCE = `You can persist durable workspace knowledge using the memory tool.
Use target="user" for user preferences and communication/workflow expectations.
Use target="memory" for workspace facts, repo conventions, commands, lessons, and non-obvious fixes.
Character limits: user=1500, workspace=2500.
Only save compact facts that should affect future sessions.
Do not save secrets, raw logs, large code, or one-off details.
If memory is full, consolidate existing entries with replace before adding.
Use the list action to verify current entries before replacing or removing.`;
const SKILL_MANAGE_GUIDANCE = `You can create and update workspace skills using the skill_manage tool.
Workspace skills are reusable procedures/workflows stored under .agents/skills in the current workspace.

Use memory for compact durable facts.
Use skill_manage for repeatable multi-step procedures, debugging workflows, conventions, and verification steps that are too procedural for MEMORY.md.

When to create or update a skill:
- After completing a complex reusable workflow.
- After debugging through errors and discovering the working path.
- When the user corrects your approach in a way that should affect future similar tasks.
- When you discover workspace-specific procedures, pitfalls, commands, or verification steps.

When not to create a skill:
- For one-off facts or temporary context.
- For secrets, credentials, raw logs, or large code dumps.
- For obvious information already present in AGENTS.md or an existing skill.

Before creating a new skill, consider whether an existing skill should be patched instead.
Prefer patch over update for small changes.
Keep skill descriptions concise and trigger-focused because descriptions are used to decide when to load a skill.
Keep skill bodies procedural and verification-oriented.`;
const SESSION_SEARCH_GUIDANCE = `You can use session_search to recall prior conversation details from the current workspace or current session archive.
Use it when the user references past work, says "we did this before", asks what happened earlier, or when compaction may have removed exact details from active context.

Three modes:
1. List mode (action: "list"): Enumerate recent sessions in the workspace. Returns session IDs, titles, and message counts. Use this to discover what exists.
2. Search mode (provide "query"): Full-text search across messages.
3. Read mode (provide "sessionId"): Read the latest context from a session. Optionally provide "aroundMessageId" to anchor at a specific message.

Search scopes:
- scope="current_session": Search only this session archive.
- scope="workspace": Search all sessions in the current workspace (default).
- scope="agent": Search YOUR past sessions across ALL workspaces. Use this to recall work from other projects.

Typical workflow: list sessions, then read a session's latest context, then search for specific keywords if needed.
Prefer scope="current_session" when looking for details from earlier in this same conversation.
Prefer scope="workspace" when looking for related previous sessions in this workspace.
Use scope="agent" when you need to recall work from a different project.
Do not ask the user to repeat information until you have searched likely prior context.
Search results are snippets; use read mode with sessionId to get full surrounding context.
Default search focuses on user/assistant messages. Include tool results only when exact tool output, commands, errors, or logs are relevant.`;

function workspaceSection(workspacePath: string): string {
  return `<workspace>
## Working Directory

You are operating in: ${workspacePath}

### Path Resolution

All file operations support three path types:

1. **Relative Paths** (RECOMMENDED for workspace files)
   - Input: "src/app.ts"
   - Resolves to: "${workspacePath}/src/app.ts"

2. **Absolute Paths**
   - Input: "${workspacePath}/src/app.ts"
   - Used as-is

3. **Home Paths**
   - Input: "~/Documents/file.txt"
   - Expands relative to the current user's home directory

### Default Behaviors

- **File Operations**: Relative paths resolve from workspace root
- **Shell Commands**: Execute from workspace root by default
- **Search Operations**: Scoped to workspace by default


### Additional Paths

This workspace has additional directories you have full access to:
- /z
- /a

You can read, write, search, and explore files in these directories using absolute paths.
Relative paths still resolve from the primary workspace. Use absolute paths for additional paths.

### Security

Operations outside the workspace directory require explicit approval:
- Writing outside workspace: Requires approval
- Reading outside workspace: Requires approval (configurable)
- System directories: Blocked

### Best Practices

1. Use relative paths for files within the workspace
2. Use the \`cwd\` parameter in shell commands instead of \`cd\`
3. When in doubt, use absolute paths

Current workspace: ${workspacePath}
</workspace>`;
}

function goldenExpected(workspacePath: string): string {
  return [
    AGENT_MEMORY_SECTION,
    AGENT_USER_SECTION,
    'PROMPT',
    AGENT_MEMORY_SKILLS_GUIDANCE,
    SELF_DELEGATION_SECTION,
    INSTRUCTIONS_SECTION,
    workspaceSection(workspacePath),
    WORKSPACE_MEMORY_SECTION,
    MEMORY_GUIDANCE,
    SKILL_MANAGE_GUIDANCE,
    SESSION_SEARCH_GUIDANCE,
  ].join('\n\n');
}

const fullData = (workspacePath: string): ContextAssemblyData => ({
  preconfig,
  workspacePath,
  workspaceId: 'workspace',
  additionalPaths: ['/z', '/a'],
  selfDelegationAvailable: true,
});

beforeEach(() => configureEnvironment());

describe('C3 ordered context assembler', () => {
  test('reproduces the byte-exact golden with all sections in the exact current order', async () => {
    const root = await workspace('golden');
    const globalPath = join(root, 'global.md');
    await writeFile(globalPath, 'GLOBAL');
    await configureFullSources(root, globalPath);
    configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace('workspace')] }));

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const ordered = await enterAgentScope(agentScope, () =>
        getContextAssembler().build(fullData(root)));
      const fixed = await buildSystemMessage({
        preconfig,
        workspacePath: root,
        workspaceId: 'workspace',
        additionalPaths: ['/z', '/a'],
        selfDelegationAvailable: true,
      });

      expect(ordered).toBe(goldenExpected(root));
      expect(fixed).toBe(goldenExpected(root));

      // HEAD-baseline anchors, verified against this branch's HEAD: the
      // memory section is read from `${workspacePath}/.capek` and the
      // workspace section keeps its exact parameterized examples.
      expect(ordered).toContain('<user_memory path="USER.md" usage="16/1500">\n- WORKSPACE_USER\n</user_memory>');
      expect(ordered).toContain('<workspace_memory path="MEMORY.md" usage="18/2500">\n- WORKSPACE_MEMORY\n</workspace_memory>');
      expect(ordered).toContain(`- Input: "src/app.ts"\n   - Resolves to: "${root}/src/app.ts"`);
      expect(ordered).toContain(`- Input: "${root}/src/app.ts"\n   - Used as-is`);
      expect(ordered).toContain('- Input: "~/Documents/file.txt"');
      expect(ordered).toContain('- /z\n- /a');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('a captured assembler stays bound to its owning scope regardless of the ambient scope', async () => {
    const markerPlugin = (id: string, content: string): CapekPlugin<unknown> => ({
      id,
      scope: 'agent',
      setup: (context: PluginContext) => {
        context.contributeContext({
          id: 'marker',
          phase: 'task',
          order: 60,
          provide: () => content,
        });
      },
    });
    const processScope = await createProcessScope([]);
    const agentA = await createAgentScope(processScope, [
      createContextSectionsPlugin('bind.a-context-sections'),
      markerPlugin('bind.a-marker', 'A-marker'),
    ]);
    const agentB = await createAgentScope(processScope, [
      createContextSectionsPlugin('bind.b-context-sections'),
      markerPlugin('bind.b-marker', 'B-marker'),
    ]);
    try {
      const assemblerA = agentA.require(capekContextAssemblerKey);
      const assemblerB = agentB.require(capekContextAssemblerKey);
      const data: ContextAssemblyData = { preconfig };

      const expectedA = await assemblerA.build(data);
      expect(expectedA).toContain('A-marker');
      expect(expectedA).not.toContain('B-marker');

      // Scope B is ambient (its assembler seeded), but the captured
      // assembler A still builds exactly A's sections.
      const whileBAmbient = await withContextAssembler(assemblerB, () => assemblerA.build(data));
      expect(whileBAmbient).toBe(expectedA);
      expect(whileBAmbient).toContain('A-marker');
      expect(whileBAmbient).not.toContain('B-marker');
    } finally {
      await agentA.dispose();
      await agentB.dispose();
      await processScope.dispose();
    }
  });

  test('context building rejects with LifecycleError after disposal while diagnostics stay inspectable', async () => {
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [
      createContextSectionsPlugin('disposal.context-sections'),
    ]);
    const assembler = agentScope.require(capekContextAssemblerKey);
    expect(await agentScope.buildContext({ preconfig })).not.toHaveLength(0);

    await agentScope.dispose();

    await expect(agentScope.buildContext({ preconfig })).rejects.toBeInstanceOf(LifecycleError);
    await expect(assembler.build({ preconfig })).rejects.toBeInstanceOf(LifecycleError);

    // Diagnostics stay inspectable after disposal: lifecycle tests rely on
    // disposed snapshots.
    const snapshot = agentScope.snapshot();
    expect(snapshot.status).toBe('disposed');
    expect(snapshot.scopeId).toBe(agentScope.scopeId);

    await processScope.dispose();
  });

  test('ordered assembly matches the fixed builder across every omission variant', async () => {
    const root = await workspace('parity');
    const globalPath = join(root, 'global.md');
    await writeFile(globalPath, 'GLOBAL');
    await configureFullSources(root, globalPath);
    configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace('workspace')] }));

    const disabledSettings: Workspace = {
      ...enabledWorkspace('disabled'),
      settings: {
        autoApproveSeverity: 'low',
        memory: { enabled: false, permissionRisk: 'low' },
        skills: { managementEnabled: false, permissionRisk: 'low' },
        sessionSearch: { enabled: false, permissionRisk: 'low', includeToolResults: false },
      },
    };

    const variants: ContextAssemblyData[] = [
      fullData(root),
      { preconfig },
      { preconfig, workspacePath: root },
      { preconfig, workspacePath: root, workspaceId: 'workspace' },
      { preconfig, workspacePath: root, workspaceId: 'missing-workspace' },
      { preconfig, workspacePath: root, workspaceId: 'workspace', additionalPaths: ['/z', '/a'] },
      { preconfig, workspaceId: 'workspace', selfDelegationAvailable: true },
      { preconfig: { ...preconfig, systemPrompt: '' }, workspacePath: root, workspaceId: 'workspace' },
      { preconfig, selfDelegationAvailable: false },
    ];

    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      await enterAgentScope(agentScope, async () => {
        for (const variant of variants) {
          const fixed = await buildSystemMessage(variant);
          const ordered = await getContextAssembler().build(variant);
          expect(ordered).toBe(fixed);
        }
      });

      configureStorage(createInMemoryStorageBundle({ workspaces: [disabledSettings] }));
      const disabledProcess = await createCurrentProcessScope();
      const disabledAgent = await createCurrentAgentScope(disabledProcess);
      try {
        await enterAgentScope(disabledAgent, async () => {
          for (const variant of [fullData(root), { preconfig, workspacePath: root, workspaceId: 'disabled' }]) {
            const fixed = await buildSystemMessage(variant);
            const ordered = await getContextAssembler().build(variant);
            expect(ordered).toBe(fixed);
          }
        });
      } finally {
        await disabledAgent.dispose();
        await disabledProcess.dispose();
      }

      // Without an agent directory, the agent layers and their guidance omit.
      configureAgentSource();
      configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace('workspace')] }));
      const noAgentProcess = await createCurrentProcessScope();
      const noAgentScope = await createCurrentAgentScope(noAgentProcess);
      try {
        await enterAgentScope(noAgentScope, async () => {
          const fixed = await buildSystemMessage(fullData(root));
          const ordered = await getContextAssembler().build(fullData(root));
          expect(ordered).toBe(fixed);
          expect(ordered).not.toContain('AGENT_MEMORY');
          expect(ordered).not.toContain('You have personal memory and skills');
        });
      } finally {
        await noAgentScope.dispose();
        await noAgentProcess.dispose();
      }
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('preserves the empty-prompt artifact byte-for-byte', async () => {
    const root = await workspace('empty-prompt');
    const globalPath = join(root, 'global.md');
    await writeFile(globalPath, 'GLOBAL');
    await configureFullSources(root, globalPath);
    configureStorage(createInMemoryStorageBundle({ workspaces: [enabledWorkspace('workspace')] }));

    const data: ContextAssemblyData = {
      preconfig: { ...preconfig, systemPrompt: '' },
      workspacePath: root,
      workspaceId: 'workspace',
      additionalPaths: ['/z', '/a'],
    };
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      const ordered = await enterAgentScope(agentScope, () => getContextAssembler().build(data));
      const fixed = await buildSystemMessage(data);

      expect(ordered).toBe(fixed);
      expect(ordered).toBe(
        [AGENT_MEMORY_SECTION, AGENT_USER_SECTION, '', AGENT_MEMORY_SKILLS_GUIDANCE].join('\n\n')
        + '\n\n' + INSTRUCTIONS_SECTION
        + '\n\n' + workspaceSection(root)
        + '\n\n' + WORKSPACE_MEMORY_SECTION
        + '\n\n' + MEMORY_GUIDANCE
        + '\n\n' + SKILL_MANAGE_GUIDANCE
        + '\n\n' + SESSION_SEARCH_GUIDANCE,
      );
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('registers the exact section ids, phases, and orders in diagnostics', async () => {
    const processScope = await createCurrentProcessScope();
    const agentScope = await createCurrentAgentScope(processScope);
    try {
      expect(agentScope.listContextSections().map((section) => section.id)).toEqual([
        ...CURRENT_CONTEXT_SECTION_IDS,
      ]);
      expect(agentScope.listContextSections().map((section) => section.phase)).toEqual([
        'identity', 'identity', 'identity', 'identity', 'identity',
        'instructions',
        'workspace', 'workspace', 'workspace', 'workspace', 'workspace',
      ]);
      expect(agentScope.listContextSections().map((section) => section.order)).toEqual([
        10, 20, 30, 40, 50, 10, 10, 20, 30, 40, 50,
      ]);
      expect(agentScope.snapshot().contextSections.map((section) => section.id)).toEqual([
        ...CURRENT_CONTEXT_SECTION_IDS,
      ]);
      expect(agentScope.require(capekContextAssemblerKey).id).toBe('current.context-sections');
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('rejects a duplicate context section id during composition', async () => {
    const processScope = await createProcessScope([]);
    const duplicate: CapekPlugin<unknown> = {
      id: 'dup.extra-section',
      scope: 'agent',
      setup: (context: PluginContext) => {
        context.contributeContext({
          id: 'system-prompt',
          phase: 'identity',
          order: 5,
          provide: () => 'shadow',
        });
      },
    };

    const error = await createAgentScope(processScope, [
      createContextSectionsPlugin('dup.context-sections'),
      duplicate,
    ]).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).not.toBeNull();
    expect(String((error as Error).message)).toContain("context section 'system-prompt' is already registered");
    expect((error as { cause?: unknown }).cause).toBeInstanceOf(DuplicateContributionError);
    await processScope.dispose();
  });

  test('passes typed assembly data through section providers and fails predictably on malformed data', async () => {
    const processScope = await createProcessScope([]);
    const probe: CapekPlugin<unknown> = {
      id: 'probe.typed-data',
      scope: 'agent',
      setup: (context: PluginContext) => {
        context.contributeContext({
          id: 'probe',
          phase: 'task',
          order: 10,
          provide: (build) => {
            const data = build.data as ContextAssemblyData | undefined;
            return data?.preconfig?.id ?? 'missing';
          },
        });
      },
    };
    const agentScope = await createAgentScope(processScope, [
      createContextSectionsPlugin('typed.context-sections'),
      probe,
    ]);
    try {
      const built = await agentScope.buildContext<ContextAssemblyData>({
        preconfig: { ...preconfig, id: 'typed-agent' },
      });
      expect(built).toEqual([
        { id: 'system-prompt', phase: 'identity', content: 'PROMPT' },
        { id: 'probe', phase: 'task', content: 'typed-agent' },
      ]);

      await expect(agentScope.buildContext('not-an-object' as never)).rejects.toBeInstanceOf(
        MalformedPluginError,
      );
      await expect(
        agentScope.buildContext({} as ContextAssemblyData),
      ).rejects.toBeInstanceOf(ContextAssemblyDataError);
      await expect(
        agentScope.buildContext({ preconfig: { id: 'agent', systemPrompt: 42 } as never }),
      ).rejects.toBeInstanceOf(ContextAssemblyDataError);

      // Assembler-level validation fails before any section provider runs.
      const validatingAssembler = createOrderedContextAssembler('test.assembler', () => {
        throw new Error('sections must not run for invalid data');
      });
      await expect(validatingAssembler.build({} as never)).rejects.toBeInstanceOf(
        ContextAssemblyDataError,
      );
      await expect(
        validatingAssembler.build({ preconfig: { id: 'agent', systemPrompt: 42 } as never }),
      ).rejects.toBeInstanceOf(ContextAssemblyDataError);
      // Outside any entered scope the ALS compatibility runtime falls back to
      // the fixed legacy adapter: the current server path stays byte-exact.
      expect(getContextAssembler().id).toBe('fixed-legacy-adapter');
      expect(await getContextAssembler().build(fullData('/workspace')))
        .toBe(await buildSystemMessage(fullData('/workspace')));
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });

  test('PluginContext.buildContext assembles the current scope chain with data passthrough', async () => {
    const observed: string[] = [];
    const first: CapekPlugin<unknown> = {
      id: 'a-first',
      scope: 'agent',
      setup: (context: PluginContext) => {
        context.contributeContext({
          id: 'a-first-section',
          phase: 'identity',
          order: 1,
          provide: (build) => JSON.stringify(build.data ?? null),
        });
      },
    };
    const observer: CapekPlugin<unknown> = {
      id: 'b-observer',
      scope: 'agent',
      setup: async (context: PluginContext) => {
        const sections = await context.buildContext({ probe: 'value' });
        observed.push(...sections.map((section) => `${section.id}:${section.content}`));
      },
    };
    const processScope = await createProcessScope([]);
    const agentScope = await createAgentScope(processScope, [first, observer]);
    try {
      expect(observed).toEqual(['a-first-section:{"probe":"value"}']);
      expect(await agentScope.buildContext({ probe: 'later' })).toEqual([
        { id: 'a-first-section', phase: 'identity', content: '{"probe":"later"}' },
      ]);
    } finally {
      await agentScope.dispose();
      await processScope.dispose();
    }
  });
});

describe('C3 facade and isolation', () => {
  function captureHistory(onEvent: (event: SandboxControlEvent) => void, history: SandboxHistoryEntry[]) {
    return (event: SandboxControlEvent): void => {
      if (event.type === 'sandbox.history') {
        history.splice(0, history.length, ...event.entries);
      }
      onEvent(event);
    };
  }

  test('composition real runs build the system message through the ordered assembler', async () => {
    const root = await workspace('composition-run');
    const history: SandboxHistoryEntry[] = [];
    const agent = new StandaloneAgent({
      model: 'openai/gpt-4o-mini',
      workspace: root,
      prompt: 'CUSTOM-PROMPT',
      sandbox: {
        onEvent: captureHistory(() => {}, history),
      },
    });

    const result = await agent.run('inspect');
    expect(result.status).toBe('completed');

    const entry = history.at(-1)!;
    const expected = await buildSystemMessage({
      preconfig: { id: 'capek-default', systemPrompt: 'CUSTOM-PROMPT' } as Preconfig,
      workspacePath: root,
      workspaceId: root,
    });
    expect(entry.context.systemPrompt).toBe(expected);
    expect(entry.context.systemPrompt).toContain('CUSTOM-PROMPT');
    expect(entry.context.systemPrompt).toContain('<workspace>');

    await agent.close();
  });

  test('two interleaved agent scopes assemble isolated context through their own sources', async () => {
    const sharedProcessScope = await createCurrentProcessScope();
    const compositionA = await createComposition(sharedProcessScope, {
      storage: createInMemoryStorageBundle(),
      configuration: createDefaultRuntimeConfiguration(),
      host: minimalHost(),
      contextSources: {
        agents: {
          getDirectory: async (id) => (id === 'agent-a' ? '/agents/a' : null),
          readMemoryFile: async () => 'MEM-A',
        },
      },
      workspaceToolDiscovery: {},
      toolResolver: { get: () => null, list: () => [] },
      sandboxController: new SandboxController(),
      providerOverrides: new Map(),
    });
    const compositionB = await createComposition(sharedProcessScope, {
      storage: createInMemoryStorageBundle(),
      configuration: createDefaultRuntimeConfiguration(),
      host: minimalHost(),
      contextSources: {
        agents: {
          getDirectory: async (id) => (id === 'agent-b' ? '/agents/b' : null),
          readMemoryFile: async () => 'MEM-B',
        },
      },
      workspaceToolDiscovery: {},
      toolResolver: { get: () => null, list: () => [] },
      sandboxController: new SandboxController(),
      providerOverrides: new Map(),
    });

    try {
      const result = await enterAgentScope(compositionA.agentScope, async () => {
        const buildA = getContextAssembler().build({
          preconfig: { id: 'agent-a', systemPrompt: 'A' } as Preconfig,
        });
        const observedB = await enterAgentScope(compositionB.agentScope, async () => {
          const assemblerB = getContextAssembler();
          expect(assemblerB.id).toBe('facade.context-sections');
          return assemblerB.build({ preconfig: { id: 'agent-b', systemPrompt: 'B' } as Preconfig });
        });
        return { a: await buildA, b: observedB };
      });

      expect(result.a).toContain('<agent_memory>\nMEM-A\n</agent_memory>');
      expect(result.a).not.toContain('MEM-B');
      expect(result.b).toContain('<agent_memory>\nMEM-B\n</agent_memory>');
      expect(result.b).not.toContain('MEM-A');
    } finally {
      await compositionA.agentScope.dispose();
      await compositionB.agentScope.dispose();
      await sharedProcessScope.dispose();
    }
  });
});

describe('C3 fixed legacy adapter', () => {
  beforeEach(() => configureEnvironment());

  test('stays exported through the compat path with unchanged behavior', async () => {
    const fixed = await buildSystemMessage({
      preconfig,
      workspacePath: '/workspace',
      selfDelegationAvailable: true,
    });
    expect(fixed).toBe('PROMPT\n\nSELF-DELEGATION:\n- You may use the task tool with subagent_type "agent" to delegate work to a fresh instance of yourself.\n- This permission applies only to the immediate child. Reusing "agent" later in the same ancestry chain is blocked.\n\n<workspace>\n## Working Directory\n\nYou are operating in: /workspace\n\n### Path Resolution\n\nAll file operations support three path types:\n\n1. **Relative Paths** (RECOMMENDED for workspace files)\n   - Input: "src/app.ts"\n   - Resolves to: "/workspace/src/app.ts"\n\n2. **Absolute Paths**\n   - Input: "/workspace/src/app.ts"\n   - Used as-is\n\n3. **Home Paths**\n   - Input: "~/Documents/file.txt"\n   - Expands relative to the current user\'s home directory\n\n### Default Behaviors\n\n- **File Operations**: Relative paths resolve from workspace root\n- **Shell Commands**: Execute from workspace root by default\n- **Search Operations**: Scoped to workspace by default\n### Security\n\nOperations outside the workspace directory require explicit approval:\n- Writing outside workspace: Requires approval\n- Reading outside workspace: Requires approval (configurable)\n- System directories: Blocked\n\n### Best Practices\n\n1. Use relative paths for files within the workspace\n2. Use the `cwd` parameter in shell commands instead of `cd`\n3. When in doubt, use absolute paths\n\nCurrent workspace: /workspace\n</workspace>');
  });
});
