export const jean2CompatibilityPhase = 9 as const;

// The ALS compatibility runtime falls back to the fixed legacy builder until
// a composed agent scope seeds its ordered assembler. Installed here so the
// Jean2 server path (which runs outside enterAgentScope) keeps the exact
// pre-C3 system-message behavior byte-for-byte.
import { setDefaultContextAssembler } from '../context/assembler';
import { fixedBuilderContextAssembler } from '../plugins/legacy-system-message';

setDefaultContextAssembler(fixedBuilderContextAssembler);

// Explicit unscoped session-search, scheduler, task, workflow, memory, and
// skills tool fallback installation. No module-load registration: the Jean2
// compatibility bindings installation (server bootstrap) and focused tests
// call these directly.
export { installSchedulerToolFallback } from '../plugins/scheduler-domain';
export { installSessionSearchToolFallback } from '../plugins/session-search-domain';
export { installTaskToolFallback } from '../plugins/subagent-domain';
export { installWorkflowToolFallback } from '../plugins/workflow-domain';
export { installMemoryToolFallback } from '../plugins/memory-domain';
export { installSkillsToolFallback } from '../plugins/skills-domain';

export {
  getJean2CompatibilityBindings,
  setJean2CompatibilityBindings,
  withJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
} from './bindings';
export { configureStorage, getStorage } from '../storage/runtime';
export {
  configureRuntimeConfiguration,
  getApiKeyForProvider,
  getRuntimeConfiguration,
  withRuntimeConfiguration,
} from '../configuration/runtime';
export type * from '../configuration/contracts';
export * from '../providers/registry';
export type * from '../providers/types';
export * from '../context';
export * from '../memory';
export * from '../skills';
export * from '../session-search';
export * from '../scheduler/host';
export * from '../scheduler/scheduler-tool';
export type { StorageBundle } from '../storage/contracts';
export type { RuntimeAudience, RuntimeDelivery, RuntimeEvent, RuntimeEventContext, RuntimeEventSink } from '../runtime/events';

export { chat, streamChat } from '../core/agent';
export type { ChatOptions, ChatResult } from '../core/agent';
export {
  createRetryCircuitState,
  streamChatWithRetry,
  withRetryCircuitState,
} from '../core/retry';
export type { StreamChatEvent, StreamChatFn, StreamRetryPolicy } from '../core/retry';
export { InterruptManager, interruptManager } from '../core/interrupt';
export * from '../core/compaction';
export * from '../core/compaction-executor';
/**
 * C6 step 2 temporary store-wiring seam. The reconciliation decisions moved
 * from the Jean2 store into the Capek compaction domain; these deps-based
 * entrypoints exist only so `store/compaction-recovery.ts` can wire the
 * inward-facing port to the domain while keeping its pre-slice export
 * identities. The WithDeps names cannot be confused with the old store
 * signatures (sessionId, options). Retired with the store compat path.
 */
export {
  reconcileAllSessionsCompaction as reconcileAllSessionsCompactionWithDeps,
  reconcileSessionCompaction as reconcileSessionCompactionWithDeps,
} from '../compaction/recovery';
export type { CompactionRecoveryDeps } from '../compaction/recovery';
export { forkSession } from '../core/fork';
export { revertToStep } from '../core/revert';
export * from '../core/workflow-orchestrator-session';
export { buildContinuationMessage, evaluateGoal } from '../core/goal-evaluator';
export { runGoalLoop } from '../core/goal-loop';
export type { RunTurnFn } from '../core/goal-loop';
export { handleChat, handleSessionEditMessage, regenerateSessionTitle } from '../core/chat-handler';
export type { RuntimeRequestContext } from '../core/chat-handler';
export * from '../core/subagent-policy';
export { executeChildSession } from '../core/child-session';
export * from '../core/subagent';
export { decomposeTask } from '../core/workflow-decomposer';
export * from '../core/workflow-synthesizer';
export * from '../core/workflow';
export * from '../core/build-tools';
export * from '../core/stream-handlers';
export * from '../core/step-handlers';
export * from '../core/message-utils';
export * from '../core/part-utils';
export * from '../core/model-utils';
export * from '../adapters/ai-sdk';
export * from '../core/provider-utils';
export * from '../core/error-handling';
export * from '../core/structured-output';
export * from '../core/tool-capabilities';
export * from '../core/stream/compaction-threshold';
export * from '../core/stream/finalization';
export * from '../core/stream/stream-config';
export * from '../plugins/legacy-system-message';
export * from '../core/tool-builders/agent-tools';
export * from '../core/tool-builders/external-tools';
export * from '../core/tool-builders/workspace-tools';
export type * from '../core/tool-builders/types';
export * from '../tools/executor';
export * from '../tools/ask-user-api';
export * from '../tools/permission-request-manager';
export * from '../tools/workspace-capability';
export {
  createWorkspaceService,
  expandPath,
  getWorkspaceService,
  isInsideUnselectedAdditionalRoot,
  isPathInside,
  isPathWithinWorkspace,
  resolveCandidatePath,
  resolvePath,
  resolveRootForQuery,
  selectEditableRoot,
  withWorkspaceService,
} from '../workspace/policy';
export type {
  WorkspacePolicy,
  WorkspacePolicyOptions,
  WorkspaceService,
} from '../workspace/contracts';
export {
  createToolOutputService,
  getToolOutputService,
  isToolOutputArtifactReference,
  RETRIEVE_TOOL_OUTPUT_NAME,
  TOOL_OUTPUT_PREVIEW_CHARS,
  TOOL_OUTPUT_THRESHOLD_CHARS,
  truncateToolResult,
  withToolOutputService,
} from '../tool-output/policy';
export type {
  ToolOutputArtifactReference,
  ToolOutputArtifactService,
  ToolOutputFallback,
  ToolOutputPolicyContext,
  ToolOutputPolicyOptions,
} from '../tool-output/contracts';
export * from '../tools/llm-api';
export * from '../tools/registry';
export * from '../tools/install-manifest';
export type * from '../tools/types';
export * from '../tools/tool-artifact';
export * from '../utils/errors';
export * from '../utils/truncate-tool-result';
export * from '../utils/strip-visualization';
export { SandboxLanguageModel } from '../sandbox/model';
export { SandboxProvider } from '../sandbox/provider';
export { SandboxController, sandboxController } from '../sandbox/controller';
export * from '../tools/tool-source';
export type * from '../sandbox/types';
