// Single seam for non-harness server code to reach Capek public contracts.
// Harness-owned behavior (the composed Jean2 scope and the ask resolution
// that must land in it) lives under harnesses/prokop instead; infrastructure,
// transport, and config consume only the neutral re-exports below.

export {
  createCapabilityTool,
  createOpenAiResponsesModel,
  executeChildSession,
  findProviderFromModel,
  getProvider,
  getProviderStatus,
  registerProvider,
  runTextModel,
  type CapabilityTool,
  type ConnectableProvider,
  type TokenResponse,
} from '@capekai/core/providers';

export {
  getTool,
  listTools,
  scanTools,
} from '@capekai/core/tools';

// Unscoped ask-authority fallbacks against the process-default Capek
// runtime. Consumers should prefer the installed application
// AskResolutionPort (bootstrap installs the composed-scope implementation);
// these preserve pre-composition behavior when no port is installed, the
// same way the composed-scope wrapper itself falls back unscoped.
export {
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
  getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk,
  resolveAsk as capekResolveAsk,
} from '@capekai/core/ask-authority';

export {
  SandboxProvider,
  sandboxController,
  type AutoResponderRule,
  type SandboxControlEvent,
  type SandboxResponse,
  type SandboxRespondMessage,
} from '@capekai/core/sandbox';

export {
  buildToolOutputArtifactPage,
  DEFAULT_TOOL_OUTPUT_PAGE_CHARS,
  isToolOutputArtifactId,
  MAX_TOOL_OUTPUT_PAGE_CHARS,
  type CreateToolOutputArtifact,
  type ToolOutputArtifact,
  type ToolOutputArtifactPage,
  type ToolOutputArtifactStore,
} from '@capekai/core/storage';
