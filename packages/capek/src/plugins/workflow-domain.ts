import type { WorkflowInput, WorkflowResult } from '@capekai/types';
import { serviceKey } from '../kernel/service-key';
import type {
  CapekPlugin,
  PluginContext,
  ToolDefinition as KernelToolDefinition,
} from '../kernel/types';
import {
  DOMAIN_TOOL_PAYLOAD_FIELD,
  registerDomainToolFallback,
  type DomainToolPayload,
} from '../runtime/domain-tool-source';
import {
  buildWorkflowToolDefinition,
  canSpawnSubagent,
  executeWorkflow,
  executeWorkflowWithDeps,
  getWorkflowToolDefinition,
  type GetWorkflowToolDefinitionOptions,
  type WorkflowExecutionOptions,
  type WorkflowServiceDeps,
  type WorkflowToolDefinition,
} from '../workflow/execution';
import {
  capekSubagentDomainKey,
  type SubagentDomainService,
} from './subagent-domain';
import {
  capekOrchestratorSessionKey,
  type OrchestratorSessionContract,
} from './service-keys';

/**
 * C5 workflow domain plugin. Owns the agent-scoped workflow service and the
 * `workflow` tool contribution through the generic contributed-domain-tool
 * seam. Decompose → fan out → synthesize runs over the scope-captured
 * subagent domain service (leaf execution, depth, targets, subagent
 * listing) and the shared `capek.orchestrator-session` contract; composed
 * payloads never read module globals. The unscoped fallback keeps the
 * pre-C5 module accessors and is installed explicitly, never at module
 * load.
 */

export const CURRENT_WORKFLOW_DOMAIN_PLUGIN_ID = 'current.workflow-domain';
export const WORKFLOW_TOOL_CONTRIBUTION_ID = 'workflow.workflow';
/** Between task (650) and session_search (700) so the composed tool order
 * keeps the pre-C5 relative position: workflow before session_search and
 * scheduler. */
export const WORKFLOW_TOOL_CONTRIBUTION_ORDER = 690;

export interface WorkflowDomainService {
  readonly tools: readonly DomainToolPayload[];
  /** Depth gate shared by the workflow tool payload. */
  canSpawn(sessionId: string): boolean | Promise<boolean>;
  resolveDefinition(
    options: GetWorkflowToolDefinitionOptions,
  ): Promise<WorkflowToolDefinition | null>;
  execute(input: WorkflowInput, options: WorkflowExecutionOptions): Promise<WorkflowResult>;
}

export const capekWorkflowDomainKey = serviceKey<WorkflowDomainService>(
  'capek.workflow-domain',
  'agent',
);

interface WorkflowPayloadDeps {
  canSpawn(sessionId: string): boolean | Promise<boolean>;
  resolveDefinition(
    options: GetWorkflowToolDefinitionOptions,
  ): Promise<WorkflowToolDefinition | null>;
  execute(input: WorkflowInput, options: WorkflowExecutionOptions): Promise<WorkflowResult>;
}

function workflowPayload(deps: WorkflowPayloadDeps): DomainToolPayload {
  const placeholder = buildWorkflowToolDefinition([]);
  return {
    name: placeholder.name,
    description: placeholder.description,
    inputSchema: placeholder.inputSchema,
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
        allowedSubagentIds: definition.allowedSubagentIds,
      };
    },
    execute: async (input, context) => {
      const workflowInput = {
        prompt: input.prompt as string,
        ...(input.description ? { description: input.description as string } : {}),
        ...(input.subtasks ? { subtasks: input.subtasks as WorkflowInput['subtasks'] } : {}),
        ...(input.leafPreconfigId ? { leafPreconfigId: input.leafPreconfigId as string } : {}),
        ...(input.outputSchema ? { outputSchema: input.outputSchema as Record<string, unknown> } : {}),
      } as WorkflowInput;

      // No broadcast pass-through: pre-C5 leaves defaulted to the module
      // broadcast, and composed leaves default to the subagent domain's
      // scope-captured host delivery.
      return deps.execute(workflowInput, {
        sessionId: context.sessionId,
        workspaceId: typeof context.workspaceId === 'string' ? context.workspaceId : undefined,
        workspacePath: typeof context.workspacePath === 'string' ? context.workspacePath : undefined,
        abortSignal: context.abortSignal as AbortSignal | undefined,
        allowedSubagentIds: context.allowedSubagentIds as string[] | undefined,
      }) as unknown as Promise<Record<string, unknown>>;
    },
  };
}

/** Unscoped compatibility payload: keeps the pre-C5 execute-time module
 * accessors. Installed through `installWorkflowToolFallback`, never at
 * module load. */
export function createWorkflowToolFallbackPayload(): DomainToolPayload {
  return workflowPayload({
    canSpawn: canSpawnSubagent,
    resolveDefinition: (options) => getWorkflowToolDefinition(options),
    execute: (input, options) => executeWorkflow(input, options),
  });
}

/** Explicitly installs the unscoped legacy fallback. Called by the Jean2
 * compatibility bindings installation (server bootstrap) and by focused
 * tests; no module-load registration exists. */
export function installWorkflowToolFallback(): void {
  registerDomainToolFallback('workflow', createWorkflowToolFallbackPayload());
}

export function workflowDomainPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekWorkflowDomainKey],
    requires: [capekSubagentDomainKey, capekOrchestratorSessionKey],
    setup(context: PluginContext) {
      const subagent: SubagentDomainService = context.require(capekSubagentDomainKey);
      const orchestrator: OrchestratorSessionContract = context.require(capekOrchestratorSessionKey);

      const serviceDeps: WorkflowServiceDeps = {
        canSpawn: subagent.canSpawnSubagent,
        listSubagents: subagent.listSubagents,
        executeLeaf: subagent.execute,
        orchestrator,
      };

      const service: WorkflowDomainService = {
        tools: [
          workflowPayload({
            canSpawn: async (sessionId) => subagent.canSpawnSubagent(sessionId),
            resolveDefinition: async (options) => {
              // The composed path resolves targets through the subagent
              // domain service's scope-captured deps; it never reads module
              // globals.
              const maximumDepthReached = !(await subagent.canSpawnSubagent(options.sessionId));
              return subagent.resolveTargets({
                ...options,
                maximumDepthReached,
              }).then((targets) =>
                targets.length === 0 ? null : buildWorkflowToolDefinition(targets));
            },
            execute: (input, options) => executeWorkflowWithDeps(input, options, serviceDeps),
          }),
        ],
        canSpawn: async (sessionId) => subagent.canSpawnSubagent(sessionId),
        resolveDefinition: async (options) => {
          const maximumDepthReached = !(await subagent.canSpawnSubagent(options.sessionId));
          return subagent.resolveTargets({
            ...options,
            maximumDepthReached,
          }).then((targets) =>
            targets.length === 0 ? null : buildWorkflowToolDefinition(targets));
        },
        execute: (input, options) => executeWorkflowWithDeps(input, options, serviceDeps),
      };

      context.provide(capekWorkflowDomainKey, service);
      context.contributeTool({
        id: WORKFLOW_TOOL_CONTRIBUTION_ID,
        order: WORKFLOW_TOOL_CONTRIBUTION_ORDER,
        definition: {
          name: service.tools[0].name,
          description: service.tools[0].description,
          inputSchema: service.tools[0].inputSchema,
          timeout: 600000,
          [DOMAIN_TOOL_PAYLOAD_FIELD]: service.tools[0],
        } as KernelToolDefinition,
        requiredCapabilities: [capekWorkflowDomainKey],
      });
    },
  };
}
