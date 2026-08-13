import { describe, expect, test } from 'bun:test';

const expectedValueExports: Record<string, string[]> = {
  '@/core/agent': ['chat', 'streamChat'],
  '@/core/retry': ['streamChatWithRetry'],
  '@/core/stream-handlers': ['createStreamHandlers'],
  '@/core/step-handlers': ['createStepCallbacks'],
  '@/core/message-utils': ['convertToAiSdkMessages'],
  '@/core/part-utils': [
    'createStepPart', 'isFilePart', 'isImagePart', 'isTextPart', 'isToolPart', 'parseToolInput',
  ],
  '@/core/model-utils': ['getModel', 'getModelWithMetadata'],
  '@/core/provider-utils': ['findProviderFromModel', 'getApiKeyForProvider', 'resolveModelId', 'resolveProviderId'],
  '@/core/error-handling': ['createErrorEvent'],
  '@/core/structured-output': ['buildSchemaPromptInstruction', 'extractJsonFromText'],
  '@/core/compaction': [
    'buildConversationText', 'createCompactionTrigger', 'estimateToolOutputSize', 'formatOutput',
    'getDefaultCompactionPolicy', 'persistCompactionFailure', 'processCompactionTask',
    'resolveCompactionPolicy',
  ],
  '@/core/compaction-executor': ['executeCompaction', 'isCompactionActive'],
  '@/core/fork': ['forkSession'],
  '@/core/revert': ['revertToStep'],
  '@/core/workflow-orchestrator-session': ['runOrchestratorSession'],
  '@/core/goal-evaluator': ['buildContinuationMessage', 'evaluateGoal'],
  '@/core/goal-loop': ['runGoalLoop'],
  '@/core/chat-handler': ['handleChat', 'handleSessionEditMessage', 'regenerateSessionTitle'],
  '@/core/subagent-policy': [
    'collectSubagentAncestry', 'evaluateSubagentTarget', 'getSubagentResumeError',
    'isSubagentSpawningDisabled', 'isValidSubagentPreconfig',
    'isValidSubagentTargetPreconfig', 'resolveEffectiveSubagentTargets',
  ],
  '@/core/child-session': ['executeChildSession'],
  '@/core/subagent': ['canSpawnSubagent', 'executeSubagent', 'getSubagentToolDefinition'],
  '@/core/workflow-decomposer': ['decomposeTask'],
  '@/core/workflow-synthesizer': ['synthesizeResults'],
  '@/core/workflow': ['canSpawnSubagent', 'executeWorkflow', 'getWorkflowToolDefinition'],
  '@/core/interrupt': ['interruptManager'],
  '@/core/build-tools': ['buildAiSdkTools'],
  '@/core/tool-capabilities': ['isToolAllowedInContext', 'resolveToolExecutionScopes'],
  '@/core/stream/compaction-threshold': ['computeAutoThreshold'],
  '@/core/stream/finalization': ['extractFinalizationData'],
  '@/core/stream/stream-config': ['buildStreamConfig'],
  '@/core/stream/system-message': ['buildSystemMessage'],
  '@/core/tool-builders/agent-tools': ['buildAgentTools'],
  '@/core/tool-builders/external-tools': ['buildExternalTools'],
  '@/core/tool-builders/types': [],
  '@/core/tool-builders/workspace-tools': ['buildWorkspaceTools'],
  '@/tools/executor': ['executeTool'],
  '@/tools/ask-user-api': [
    'ASK_TIMEOUT', 'createAskApi', 'getAuthorityForPendingAsk', 'getSessionIdForPendingAsk',
    'hasPendingAsk', 'listPendingAsksByRootSession', 'listPendingAsksBySession', 'rejectAsk',
    'rejectPendingAsksBySession', 'rejectPendingAsksByToolCallId', 'resolveAsk',
  ],
  '@/tools/permission-request-manager': [
    'PERMISSION_TIMEOUT', 'expireOldRequests', 'getPendingRequestsByRootSession',
    'getPendingWaiterCount', 'hasPendingWaiter', 'rejectPermission',
    'rejectPermissionsBySession', 'rejectPermissionsByToolCallId', 'requestPermission',
    'resolvePermission',
  ],
  '@/tools/llm-api': ['createLlmApi'],
  '@/tools/registry': ['clearCache', 'getTool', 'listTools', 'scanTools', 'stopWatching', 'watchTools'],
  '@/tools/types': [],
  '@/tools/tool-artifact': [
    'ArtifactError', 'downloadArtifact', 'extractArtifact', 'validateArtifactStructure', 'verifyChecksum',
  ],
  '@/utils/errors': [
    'ApiErrorType', 'ERROR_AUTH', 'ERROR_CHAT_FAILED', 'ERROR_INVALID_REQUEST', 'ERROR_RATE_LIMIT',
    'ERROR_SERVER_ERROR', 'ERROR_TIMEOUT', 'classifyApiError', 'withRetry',
  ],
  '@/utils/strip-visualization': ['extractVisualization', 'stripVisualization'],
  '@/utils/truncate-tool-result': ['truncateToolResult'],
  '@/sandbox/model': ['SandboxLanguageModel'],
  '@/sandbox/provider': ['SandboxProvider'],
};

describe('Phase 4 server compatibility shims', () => {
  for (const [specifier, expected] of Object.entries(expectedValueExports)) {
    test(`${specifier} preserves its HEAD value export surface`, async () => {
      const module = await import(specifier);
      expect(Object.keys(module).sort()).toEqual([...expected].sort());
    });
  }
});
