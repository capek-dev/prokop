// =============================================================================
// Mock Data Barrel Export — Storybook mock factories and presets
// =============================================================================

// --- Helpers ---
export {
  mockId,
  resetMockIds,
  mockNow,
  mockSecondsAgo,
  mockMinutesAgo,
  mockHoursAgo,
  mockIsoNow,
  mockIsoMinutesAgo,
  mockIsoHoursAgo,
  merge,
} from './mockHelpers';

// --- Workspace ---
export {
  createWorkspace,
  workspacePresets,
} from './mockWorkspace';

// --- Session ---
export {
  createSession,
  sessionPresets,
  createSessionList,
  createSubagentSession,
} from './mockSession';

// --- Messages & Parts ---
export {
  createTextPart,
  createReasoningPart,
  createToolPart,
  createStepPart,
  createCompactionPart,
  createFilePart,
  createImagePart,
  createToolStatePending,
  createToolStateRunning,
  createToolStateCompleted,
  createToolStateError,
  createToolStateInterrupted,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createUserMessageWithParts,
  createAssistantMessageWithParts,
  createReasonedAssistantMessageWithParts,
  createAssistantMessageWithRunningTool,
  createAssistantMessageWithCompletedTool,
  createAssistantMessageWithErrorTool,
  createAssistantMessageWithStep,
  createConversation,
  createTypicalConversation,
  createQueuedMessage,
} from './mockMessage';

// --- Tools ---
export {
  createToolDefinition,
  createToolResult,
  toolDefinitionPresets,
  createToolDefinitionList,
} from './mockTool';

// --- Visualizations ---
export {
  createDiffVisualization,
  createDiffsVisualization,
  createCodeVisualization,
  createFileListVisualization,
  createTableVisualization,
  createMarkdownVisualization,
  createShellOutputVisualization,
  createNoneVisualization,
  createTodoListVisualization,
  visualizationPresets,
} from './mockVisualization';

// --- Providers & Models ---
export {
  createModelWithStatus,
  createProviderStatus,
  createProviderDescriptor,
  providerPresets,
  modelPresets,
  createModelList,
  createProviderList,
} from './mockProvider';

// --- Preconfigs ---
export {
  createPreconfig,
  preconfigPresets,
  createPreconfigList,
} from './mockPreconfig';

// --- Permissions ---
export {
  createPermissionAsk,
  permissionPresets,
} from './mockPermission';

// --- File Tree ---
export {
  createFileEntry,
  createFileTreeNode,
  fileTreePresets,
  createFileEntryList,
} from './mockFileTree';
export type { FileTreeNode } from './mockFileTree';

// --- Worktrees ---
export {
  createWorktree,
  worktreePresets,
  createRef,
  refPresets,
  createRefList,
} from './mockWorktree';
export type { MockWorktreeOverrides, MockRefOverrides } from './mockWorktree';

// --- Markdown Content ---
export {
  simpleMarkdown,
  richMarkdown,
  inlineFormattingMarkdown,
  codeBlocksMarkdown,
  shortMarkdown,
  emptyMarkdown,
  generateLongMarkdown,
  markdownPresets,
} from './mockMarkdown';

// --- Store Decorators ---
export {
  withSessionStore,
  withServerDataStore,
  withUIStore,
  withConnectionStore,
  withChatLayoutStore,
  withAskStore,
  withCompletionStore,
  withAllStores,
} from './storeDecorators';
export type { AllStoresOverrides } from './storeDecorators';

// --- Store Cleanup ---
export { resetAllStores } from './storeCleanup';

// --- Store Hydration (imperative API) ---
export { hydrateStores, clearStores } from './storeHydration';
