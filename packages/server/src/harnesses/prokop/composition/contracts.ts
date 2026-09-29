// Single seam for non-adapter server code to reach Capek public contracts.

import {
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
  getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk,
  resolveAsk as capekResolveAsk,
} from '@capekai/core/ask-authority';
import { withJean2ComposedScopeSync } from './execution-scope';

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

export {
  SandboxProvider,
  sandboxController,
  type AutoResponderRule,
  type SandboxControlEvent,
  type SandboxResponse,
  type SandboxRespondMessage,
} from '@capekai/core/sandbox';

// Wire-side ask resolution must land in the same composed permission runtime
// that execution enters: the composed scope owns the live waiters, while the
// process-default runtime capek falls back to outside any scope holds none.
// Every ask-authority re-export routes through the composed scope when the
// composition has resolved, so ask.response approval resolves the waiter the
// running tool is blocked on. Before the composition resolves no composed
// waiter can exist and the call runs unscoped unchanged.

export function resolveAsk(toolCallId: string, response: unknown, requestId?: string): Promise<boolean> {
  return withJean2ComposedScopeSync(() =>
    capekResolveAsk(toolCallId, response, requestId));
}

export async function getSessionIdForPendingAsk(toolCallId: string, requestId?: string): Promise<string | null> {
  return withJean2ComposedScopeSync(() =>
    capekGetSessionIdForPendingAsk(toolCallId, requestId));
}

export function getAuthorityForPendingAsk(toolCallId: string) {
  return withJean2ComposedScopeSync(() =>
    capekGetAuthorityForPendingAsk(toolCallId));
}

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
