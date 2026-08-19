// Single seam for non-adapter server code to reach Capek public contracts.

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
  ArtifactError,
  clearCache,
  downloadArtifact,
  extractArtifact,
  getTool,
  listTools,
  loadToolModule,
  readInstallManifest,
  scanTools,
  validateArtifactStructure,
  verifyChecksum,
  writeInstallManifest,
  type InstallManifest,
} from '@capekai/core/tools';

export {
  SandboxProvider,
  sandboxController,
  type AutoResponderRule,
  type SandboxControlEvent,
  type SandboxResponse,
  type SandboxRespondMessage,
} from '@capekai/core/sandbox';

export {
  getAuthorityForPendingAsk,
  getSessionIdForPendingAsk,
  resolveAsk,
} from '@capekai/core/ask-authority';

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
