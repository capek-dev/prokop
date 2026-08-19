/**
 * C2 service keys for the current configurable seams. Each key wraps the
 * existing contract without inventing a new abstraction: the contract types
 * below are the current module surfaces, and the ownership record lives in
 * .architecture-v2/10-current-inventory.md ("C2 provider ownership and scope
 * record"). Ownership rules:
 *
 * - Values that differ across simultaneous facade agents are agent-scoped.
 * - Values that are process-global today (registries, host-installed search
 *   and scheduler) are process-scoped.
 * - No current seam is run-scoped; run services belong to C7.
 */

import { serviceKey } from '../kernel/service-key';
import type { ProviderStatus } from '@capekai/types';
import type { LoadedTool, ToolDefinition } from '@capekai/tool';
import type { RuntimeConfiguration } from '../configuration/contracts';
import type { ContextSources } from '../context/sources';
import type { ContextAssembler } from '../context/assembler';
export type { ContextAssembler, ContextAssemblyData } from '../context/assembler';
import type { RetryPolicy } from '../retry/policy';
import type { CompactionService } from '../compaction/policy';
import type { AskPermissionPolicyService } from '../permission/contracts';
import type { PermissionRuntimeService } from '../permission/contracts';
import type { WorkspaceService } from '../workspace/contracts';
import type { ToolOutputArtifactService } from '../tool-output/contracts';
import type { ConnectableProvider, ConnectOptions, ConnectResult, ModelFactoryOptions, ModelFactoryResult } from '../providers/types';
import type { BroadcastFn, BroadcastSessionFn, RuntimeHost } from '../runtime/host';
import type { SandboxController } from '../sandbox/controller';
import type { SchedulerHost } from '../scheduler/host';
import type { SessionSearchHost } from '../session-search/host';
import type { StorageBundle } from '../storage/contracts';
import type { ToolRegistryResolver } from '../tools/registry';
import type { WorkspaceToolDiscovery } from '../tools/tool-source';
import type { AgentDriver } from '../runtime/agent-runtime';
import type { DefaultDriverInput } from '../runtime/default-agent-driver';

/** Current `providers/registry.ts` surface. `createModelForProvider` is the
 * model factory seam; a separate model-service contract is a C7 concern. */
export interface ProviderRegistryContract {
  registerProvider(provider: ConnectableProvider): void;
  getProvider(id: string): ConnectableProvider | undefined;
  getConnectableProviders(): ConnectableProvider[];
  getProviderStatus(id: string): ProviderStatus;
  connectProvider(id: string, options?: ConnectOptions): Promise<ConnectResult>;
  disconnectProvider(id: string): Promise<void>;
  createModelForProvider(options: ModelFactoryOptions): Promise<ModelFactoryResult>;
}

/** Current `tools/registry.ts` surface. `getTool` and `listTools` read the
 * seeded resolver first, exactly like the module functions they delegate to. */
export interface InstalledToolRegistryContract {
  getTool(name: string): Promise<LoadedTool | null>;
  listTools(): Promise<ToolDefinition[]>;
  scanTools(toolsPath?: string | null): Promise<LoadedTool[]>;
  watchTools(toolsPath?: string | null): void;
  stopWatching(): void;
  clearCache(): void;
  configureToolsPath(path?: string): void;
}

// Process scope: process-global registries and hosts.

export const capekProviderRegistryKey = serviceKey<ProviderRegistryContract>(
  'capek.provider-registry',
  'process',
);

export const capekInstalledToolRegistryKey = serviceKey<InstalledToolRegistryContract>(
  'capek.installed-tool-registry',
  'process',
);

export const capekSessionSearchHostKey = serviceKey<SessionSearchHost>(
  'capek.session-search-host',
  'process',
);

export const capekSchedulerHostKey = serviceKey<SchedulerHost>(
  'capek.scheduler-host',
  'process',
);

// Agent scope: per-agent values. A facade agent and a host agent must be able
// to run simultaneously with different values, so none of these may be
// process-scoped.

export const capekStorageKey = serviceKey<StorageBundle>('capek.storage', 'agent');

export const capekRuntimeConfigurationKey = serviceKey<RuntimeConfiguration>(
  'capek.runtime-configuration',
  'agent',
);

export const capekRuntimeHostKey = serviceKey<RuntimeHost>('capek.runtime-host', 'agent');

/** The facade passes `{}` (module defaults) exactly as today; the current
 * composition passes the full active source set. */
export const capekContextSourcesKey = serviceKey<Partial<ContextSources>>(
  'capek.context-sources',
  'agent',
);

export const capekWorkspaceToolDiscoveryKey = serviceKey<WorkspaceToolDiscovery>(
  'capek.workspace-tool-discovery',
  'agent',
);

/** Optional by design: only the facade composition provides it. The current
 * composition omits it so installed-tool cache resolution runs unchanged. */
export const capekToolResolverKey = serviceKey<ToolRegistryResolver>(
  'capek.tool-resolver',
  'agent',
);

export const capekSandboxControllerKey = serviceKey<SandboxController>(
  'capek.sandbox-controller',
  'agent',
);

/** Seeding an empty map is behaviorally identical to today's unseeded host
 * path: both fall through to the process-wide provider registry. */
export const capekProviderOverridesKey = serviceKey<ReadonlyMap<string, ConnectableProvider>>(
  'capek.provider-overrides',
  'agent',
);

/** Ordered context assembly is a required agent service in C3. The facade and
 * current compositions both provide it through their context-sections plugin;
 * the runtime core resolves it through `getContextAssembler()`. */
export const capekContextAssemblerKey = serviceKey<ContextAssembler>(
  'capek.context-assembler',
  'agent',
);

export const capekAgentDriverKey = serviceKey<AgentDriver<DefaultDriverInput<unknown>, unknown>>(
  'capek.agent-driver',
  'agent',
);

/**
 * C5 shared optional-domain model-turn service contract. The workflow and
 * goals slices both run short visible model turns (decomposer, synthesizer,
 * goal evaluator) through this contract; the workflow slice named it and
 * `plugins/orchestrator-session.ts` provides the current implementation
 * (`workflow/orchestrator-session.ts`), so the goals slice consumes the
 * same service without owning workflow code.
 */
export interface OrchestratorSessionContractOptions {
  parentSessionId: string;
  title: string;
  agentName: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
}

export interface OrchestratorSessionContractResult {
  text: string;
  json: Record<string, unknown> | null;
  sessionId: string;
}

export interface OrchestratorSessionContract {
  run(options: OrchestratorSessionContractOptions): Promise<OrchestratorSessionContractResult>;
}

export const capekOrchestratorSessionKey = serviceKey<OrchestratorSessionContract>(
  'capek.orchestrator-session',
  'agent',
);

/**
 * C6 retry policy service. Agent-scoped because circuit state must be
 * isolated per composed agent: two facade agents must never share circuit
 * failures. The contract and default provider live in `retry/policy.ts`;
 * the stream loop resolves the active policy through `getRetryPolicy()`.
 * Unscoped consumers keep the process-default fallback.
 */
export const capekRetryPolicyKey = serviceKey<RetryPolicy>(
  'capek.retry-policy',
  'agent',
);

/**
 * C6 compaction service. Agent-scoped because policy options are translated
 * from the composed runtime configuration at composition time, and the
 * failure cooldown plus the concurrency guard must be isolated per composed
 * agent. The contract and default provider live in `compaction/policy.ts`;
 * the executor and chat handler resolve the active service through
 * `getCompactionService()`. Unscoped consumers keep the process-default
 * fallback with live configuration reads.
 */
export const capekCompactionServiceKey = serviceKey<CompactionService>(
  'capek.compaction-service',
  'agent',
);

/**
 * C6 permission policy service. Agent-scoped because pending asks, waiters,
 * timers, and the frozen timeout options must be isolated per composed
 * agent. The contract and default provider live in `permission/`;
 * `tools/ask-user-api.ts` and `tools/permission-request-manager.ts` are the
 * pinned compatibility forwarders. Unscoped consumers keep the
 * process-default fallback with live timeout reads.
 */
export const capekPermissionPolicyKey = serviceKey<AskPermissionPolicyService>(
  'capek.permission-policy',
  'agent',
);

/**
 * C6 permission runtime service. Agent-scoped because the pending-ask and
 * waiter registries plus their timers must be isolated per composed agent.
 * NON-REPLACEABLE: the runtime owns request-id routing, validation
 * enforcement, raw-audit denial, and canonical grant construction; the
 * replaceable `capek.permission-policy` advice provider sits behind it.
 */
export const capekPermissionRuntimeKey = serviceKey<PermissionRuntimeService>(
  'capek.permission-runtime',
  'agent',
);

/**
 * C6 workspace policy service. Agent-scoped because the frozen path inputs
 * (blocked paths, sensitive patterns, home directory) belong to the
 * composed profile. The contract and default provider live in `workspace/`;
 * `tools/workspace-capability.ts` is the pinned compatibility forwarder and
 * the Jean2 server fulfills the inward-facing workspace path port through
 * the compat barrel. Unscoped consumers keep the process-default fallback.
 */
export const capekWorkspacePolicyKey = serviceKey<WorkspaceService>(
  'capek.workspace-policy',
  'agent',
);

/**
 * C6 tool-output policy service. Agent-scoped because the frozen bounding
 * and truncation thresholds plus the wrap WeakSet belong to the composed
 * profile. The contract and default provider live in `tool-output/`;
 * `tools/tool-output-artifacts.ts` and `utils/truncate-tool-result.ts` are
 * the pinned compatibility forwarders. Unscoped consumers keep the
 * process-default fallback.
 */
export const capekToolOutputPolicyKey = serviceKey<ToolOutputArtifactService>(
  'capek.tool-output-policy',
  'agent',
);

/** Every required service key in the C2 inventory. */
export const C2_SERVICE_KEYS = [
  capekStorageKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekContextSourcesKey,
  capekWorkspaceToolDiscoveryKey,
  capekToolResolverKey,
  capekSandboxControllerKey,
  capekProviderOverridesKey,
  capekContextAssemblerKey,
  capekProviderRegistryKey,
  capekInstalledToolRegistryKey,
  capekSessionSearchHostKey,
  capekSchedulerHostKey,
] as const;

/** Keys a composed agent scope must resolve before seeding accessors. */
export const C2_REQUIRED_AGENT_KEYS = [
  capekStorageKey,
  capekRuntimeConfigurationKey,
  capekRuntimeHostKey,
  capekContextSourcesKey,
  capekWorkspaceToolDiscoveryKey,
  capekSandboxControllerKey,
  capekProviderOverridesKey,
  capekContextAssemblerKey,
  capekRetryPolicyKey,
  capekCompactionServiceKey,
  capekPermissionPolicyKey,
  capekPermissionRuntimeKey,
  capekWorkspacePolicyKey,
  capekToolOutputPolicyKey,
] as const;

export const C2_PROCESS_KEYS = [
  capekProviderRegistryKey,
  capekInstalledToolRegistryKey,
  capekSessionSearchHostKey,
  capekSchedulerHostKey,
] as const;
