/**
 * Public execution entrypoint (`@capekai/core/execution`).
 *
 * Exposes exactly the agent execution identities the Jean2 server consumes
 * through its execution port: chat, edit, title regeneration, compaction,
 * fork, revert, and the interrupt manager. Every symbol resolves to the
 * owning module's identity, identical to the compatibility barrel. S8a.
 */

export {
  handleChat,
  handleSessionEditMessage,
  regenerateSessionTitle,
  type RuntimeRequestContext,
} from '../core/chat-handler';
export { interruptManager } from '../core/interrupt';
export { forkSession } from '../core/fork';
export { revertToStep } from '../core/revert';
export {
  executeCompaction,
  isCompactionActive,
} from '../compaction/executor';
export {
  getDefaultCompactionPolicy,
  resolveCompactionPolicy,
} from '../compaction/policy';
export {
  buildConversationText,
  createCompactionTrigger,
  estimateToolOutputSize,
  formatOutput,
  persistCompactionFailure,
  processCompactionTask,
} from '../compaction/task';
export type { GenerateSummaryFn } from '../compaction/contracts';
export {
  reconcileAllSessionsCompaction as reconcileAllSessionsCompactionWithDeps,
  reconcileSessionCompaction as reconcileSessionCompactionWithDeps,
  type CompactionRecoveryDeps,
} from '../compaction/recovery';
export type { RuntimeEventSink } from '../runtime/events';

// S8f test-surface additions: the execution-domain identities the server
// tests consume (agent stream loop, retry policy, goal evaluation, workflow
// orchestration, subagent policy, tool building, message/part/model utils,
// error classification, structured output, stream configuration, tool
// capabilities, and the fixed legacy system-message builder). Each symbol
// keeps its owning module's identity, identical to the compatibility barrel.
export type { ChatOptions } from '../core/agent';
export {
  createRetryCircuitState,
  withRetryCircuitState,
} from '../retry/policy';
export {
  streamChatWithRetry,
  type StreamChatEvent,
  type StreamChatFn,
} from '../retry/stream-chat';
export { buildContinuationMessage } from '../goals/evaluator';
export { runOrchestratorSession } from '../workflow/orchestrator-session';
export {
  collectSubagentAncestry,
  evaluateSubagentTarget,
  getSubagentResumeError,
  isSubagentSpawningDisabled,
  isValidSubagentPreconfig,
  isValidSubagentTargetPreconfig,
} from '../subagent/policy';
export {
  buildAiSdkTools,
  type BuildToolsOptions,
} from '../core/build-tools';
export { convertToAiSdkMessages } from '../core/message-utils';
export {
  createStepPart,
  isFilePart,
  isImagePart,
  isTextPart,
  isToolPart,
  parseToolInput,
} from '../core/part-utils';
export { getModelWithMetadata } from '../core/model-utils';
export { createErrorEvent } from '../core/error-handling';
export {
  classifyApiError,
  withRetry,
  ApiErrorType,
  type ClassifiedError,
} from '../utils/errors';
export {
  buildSchemaPromptInstruction,
  extractJsonFromText,
} from '../core/structured-output';
export {
  resolveToolExecutionScopes,
  isToolAllowedInContext,
} from '../core/tool-capabilities';
export { buildStreamConfig } from '../core/stream/stream-config';
export {
  createStreamHandlers,
  type StreamHandlerContext,
} from '../core/stream-handlers';
export {
  createStepCallbacks,
  type StepCallbacksContext,
} from '../core/step-handlers';
export { buildSystemMessage } from '../plugins/legacy-system-message';
export { createWorkspaceCapability } from '../workspace/policy';
