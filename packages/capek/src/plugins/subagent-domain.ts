import type { Preconfig } from '@capekai/types'
import type { ToolDefinition } from '@capekai/tool';
import { validateContextAssemblyData, type ContextAssemblyData } from '../context/assembler';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  ContextSectionContribution,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import type { RuntimeDelivery, RuntimeEvent } from '../runtime/events';
import type { BroadcastFn, RuntimeHost } from '../runtime/host';
import type { StorageBundle } from '../storage/contracts';
import { executeChildSession } from '../subagent/child-session';
import { selfDelegationGuidance } from '../subagent/guidance';
import {
  resolveEffectiveSubagentTargets,
  type ResolveSubagentTargetsOptions,
} from '../subagent/policy';
import {
  buildTaskToolDefinition,
  canSpawnSubagent,
  canSpawnSubagentWithDeps,
  executeSubagent,
  executeSubagentWithDeps,
  getSubagentToolDefinition,
  type GetSubagentToolDefinitionOptions,
  type SubagentInput,
  type SubagentOutput,
  type SubagentServiceBroadcasts,
  type SubagentServiceDeps,
  type SubagentServiceSessionAccess,
} from '../subagent/task-tool';
import { capekContextSourcesKey, capekRuntimeHostKey, capekStorageKey } from './service-keys';

/**
 * C5 subagent domain plugin. Owns the agent-scoped subagent service (depth
 * and ancestry policy over the captured storage and preconfig sources), the
 * `task` tool contribution through the generic contributed-domain-tool seam,
 * and the `self-delegation` context section. Composed payloads never read
 * module-level globals; the unscoped fallback keeps the pre-C5
 * execute-time module accessors and is installed explicitly, never at
 * module load.
 */

export const CURRENT_SUBAGENT_DOMAIN_PLUGIN_ID = 'current.subagent-domain';
export const SUBAGENT_TOOL_CONTRIBUTION_ID = 'subagent.task';
/** Before session-search (700) and scheduler (750) so the contributed tool
 * order keeps `task` ahead of the workspace-gated domain tools, matching
 * the pre-C5 buildAiSdkTools phase-1 placement. */
export const SUBAGENT_TOOL_CONTRIBUTION_ORDER = 650;
export const SELF_DELEGATION_SECTION_ID = 'self-delegation';

export interface SubagentDomainService {
  readonly tools: readonly DomainToolPayload[];
  /** Depth gate shared by the task tool payload. */
  canSpawnSubagent(sessionId: string): Promise<boolean>;
  resolveTargets(options: ResolveSubagentTargetsOptions): Promise<Preconfig[]>;
  /** Composed leaf execution for other C5 domains (workflow): runs the task
   * execution path over this domain's scope-captured deps, never module
   * globals. */
  execute(input: SubagentInput): Promise<SubagentOutput>;
  /** Scope-captured subagent preconfig listing for other C5 domains
   * (workflow decomposition). */
  listSubagents(): Promise<Preconfig[]>;
  /** Whether the current session may delegate to a fresh instance of its own
   * preconfig: task tool visible + allowSelfAsSubagent + the resolved target
   * list contains the current preconfig. Mirrors the pre-C5 agent.ts
   * computation over the same domain policy. */
  selfDelegationAvailable(
    sessionId: string,
    preconfigId: string,
    allowSelfAsSubagent: boolean,
  ): Promise<boolean>;
  guidance(preconfigId: string): string;
}

export const capekSubagentDomainKey = serviceKey<SubagentDomainService>(
  'capek.subagent-domain',
  'agent',
);

function deliver(host: RuntimeHost, delivery: RuntimeDelivery): void {
  host.delivery.observe?.(delivery);
  host.delivery.emit(delivery);
}

/** Runtime-host delivery projection shared by the C5 domain plugins
 * (subagent, workflow) that route leaf events through the captured host. */
export function broadcastsFromHost(host: RuntimeHost): SubagentServiceBroadcasts {
  return {
    event: (event) => deliver(host, { event, audience: { scope: 'global' } }),
    sessionCreated: (session) =>
      deliver(host, { event: { kind: 'session', action: 'created', session }, audience: { scope: 'global' } }),
    sessionUpdated: (session) =>
      deliver(host, { event: { kind: 'session', action: 'updated', session }, audience: { scope: 'global' } }),
    toSession: (sessionId: string, event: RuntimeEvent) =>
      deliver(host, { event, audience: { scope: 'session', sessionId } }),
  };
}

interface TaskPayloadDeps {
  canSpawn: (sessionId: string) => boolean | Promise<boolean>;
  resolveDefinition: (
    options: GetSubagentToolDefinitionOptions,
  ) => Promise<ToolDefinition | null>;
  execute: (input: SubagentInput) => Promise<Record<string, unknown>>;
}

function taskPayload(deps: TaskPayloadDeps): DomainToolPayload {
  const placeholder = buildTaskToolDefinition([]);
  return {
    name: placeholder.name,
    description: placeholder.description,
    inputSchema: placeholder.inputSchema,
    display: { summary: '{description}' },
    visualize: (_input, result) => {
      const taskId = typeof result.task_id === 'string' ? result.task_id : '';
      const text = typeof result.result === 'string' ? result.result : '';
      return {
        type: 'none',
        badge: taskId ? 'session ready' : undefined,
        message: text.split('\n').filter((line) => line && !line.startsWith('task_id:'))
          .join('\n').replace(/<\/?task_result>/g, '').replace(/<\/?structured_result>/g, '').trim().slice(0, 200) || 'Subagent completed',
      };
    },
    isEnabled: async (workspaceId, sessionId) =>
      typeof sessionId === 'string' && await deps.canSpawn(sessionId),
    resolveDefinition: async (sessionId, options) => {
      const definition = await deps.resolveDefinition({
        sessionId,
        canSpawnSubagents: options?.canSpawnSubagents as boolean | string[] | null | undefined,
        allowSelfAsSubagent: options?.allowSelfAsSubagent as boolean | undefined,
      });
      if (!definition) return null;
      return {
        description: definition.description,
        inputSchema: definition.inputSchema,
      };
    },
    execute: async (input, context) => {
      const subagentInput: SubagentInput = {
        description: input.description as string,
        prompt: input.prompt as string,
        subagent_type: input.subagent_type as string,
        task_id: input.task_id as string | undefined,
        sessionId: context.sessionId,
        workspaceId: typeof context.workspaceId === 'string' ? context.workspaceId : undefined,
        workspacePath: typeof context.workspacePath === 'string' ? context.workspacePath : undefined,
        abortSignal: context.abortSignal as AbortSignal | undefined,
        onSessionCreated: context.onSessionCreated as ((childSessionId: string) => void | Promise<void>) | undefined,
        allowedSubagentIds: context.allowedSubagentIds as string[] | undefined,
        broadcast: context.broadcast as BroadcastFn | undefined,
        ...(input.outputSchema ? { outputSchema: input.outputSchema as Record<string, unknown> } : {}),
      };
      return deps.execute(subagentInput);
    },
  };
}

/** Unscoped compatibility payload: keeps the pre-C5 execute-time module
 * accessors. Installed through `installTaskToolFallback`, never at module
 * load. */
export function createTaskToolFallbackPayload(): DomainToolPayload {
  return taskPayload({
    canSpawn: (sessionId) => canSpawnSubagent(sessionId),
    resolveDefinition: (options) => getSubagentToolDefinition(options),
    execute: async (input) => executeSubagent(input) as unknown as Record<string, unknown>,
  });
}

/** Explicitly installs the unscoped legacy fallback. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installTaskToolFallback(): void {
  registerDomainToolFallback('task', createTaskToolFallbackPayload());
}

type GuidanceSectionContribution = ContextSectionContribution<ContextAssemblyData>;

export function subagentDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekSubagentDomainKey],
    requires: [capekStorageKey, capekContextSourcesKey, capekRuntimeHostKey],
    setup(context: PluginContext) {
      const storage: StorageBundle = context.require(capekStorageKey);
      const contextSources = context.require(capekContextSourcesKey);
      const host: RuntimeHost = context.require(capekRuntimeHostKey);
      const preconfigSource = contextSources.preconfigs;
      const getPreconfigOrAgentScoped = (preconfigId: string): Promise<Preconfig | null> =>
        preconfigSource ? preconfigSource.getForAgent(preconfigId) : Promise.resolve(null);
      const listSubagentPreconfigsScoped = (): Promise<Preconfig[]> =>
        preconfigSource ? preconfigSource.listSubagents() : Promise.resolve([]);

      const sessionAccess: SubagentServiceSessionAccess = {
        getSession: async (sessionId) => storage.conversation.getSession(sessionId),
        createSession: async (session) => storage.conversation.createSession(session),
        updateSession: async (sessionId, updates) => storage.conversation.updateSession(sessionId, updates),
        getWorkspaceAutoApproveSeverity: async (workspaceId) => storage.workspaces.getAutoApproveSeverity(workspaceId),
      };

      const serviceDeps: SubagentServiceDeps = {
        sessionAccess,
        preconfigs: {
          getPreconfigOrAgent: getPreconfigOrAgentScoped,
          listSubagentPreconfigs: listSubagentPreconfigsScoped,
        },
        broadcasts: broadcastsFromHost(host),
        executeChild: executeChildSession,
      };

      const service: SubagentDomainService = {
        tools: [
          taskPayload({
            canSpawn: async (sessionId) => canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession),
            resolveDefinition: async (options) => {
              // The composed path resolves targets through the scope-captured
              // storage and preconfig sources; it never reads module globals.
              const deps = {
                getSession: sessionAccess.getSession,
                listPreconfigs: listSubagentPreconfigsScoped,
              };
              const maximumDepthReached = !(await canSpawnSubagentWithDeps(options.sessionId, deps.getSession));
              return resolveEffectiveSubagentTargets({
                ...options,
                maximumDepthReached,
              }, deps).then((targets) =>
                targets.length === 0 ? null : buildTaskToolDefinition(targets));
            },
            execute: (input) => executeSubagentWithDeps(input, serviceDeps) as unknown as Promise<Record<string, unknown>>,
          }),
        ],
        canSpawnSubagent: async (sessionId) => canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession),
        execute: (input) => executeSubagentWithDeps(input, serviceDeps),
        listSubagents: listSubagentPreconfigsScoped,
        resolveTargets: (options) => resolveEffectiveSubagentTargets(options, {
          getSession: sessionAccess.getSession,
          listPreconfigs: listSubagentPreconfigsScoped,
        }),
        selfDelegationAvailable: async (sessionId, preconfigId, allowSelfAsSubagent) =>
          resolveEffectiveSubagentTargets({
            sessionId,
            canSpawnSubagents: true,
            allowSelfAsSubagent,
            maximumDepthReached: !(await canSpawnSubagentWithDeps(sessionId, sessionAccess.getSession)),
          }, {
            getSession: sessionAccess.getSession,
            listPreconfigs: listSubagentPreconfigsScoped,
          }).then((targets) =>
            allowSelfAsSubagent === true && targets.some((candidate) => candidate.id === preconfigId)),
        guidance: selfDelegationGuidance,
      };

      const guidance: GuidanceSectionContribution = {
        id: SELF_DELEGATION_SECTION_ID,
        phase: 'identity',
        order: 50,
        provide: (build) => {
          const data = validateContextAssemblyData(build.data);
          return data.selfDelegationAvailable ? service.guidance(data.preconfig.id) : null;
        },
      };

      context.provide(capekSubagentDomainKey, service);
      context.contributeTool({
        id: SUBAGENT_TOOL_CONTRIBUTION_ID,
        order: SUBAGENT_TOOL_CONTRIBUTION_ORDER,
        definition: {
          name: service.tools[0].name,
          description: service.tools[0].description,
          inputSchema: service.tools[0].inputSchema,
          timeout: null,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: service.tools[0],
        } as KernelToolDefinition,
        requiredCapabilities: [capekSubagentDomainKey],
      });
      context.contributeContext(guidance);
    },
  };
}
