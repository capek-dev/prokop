// Prokop harness ask resolution.
//
// Wire-side ask resolution must land in the same composed permission runtime
// that execution enters: the composed scope owns the live waiters, while the
// process-default runtime capek falls back to outside any scope holds none.
// Every call routes through the composed scope when the composition has
// resolved, so ask.response approval resolves the waiter the running tool is
// blocked on. Before the composition resolves no composed waiter can exist
// and the call runs unscoped unchanged.
//
// Bootstrap installs this implementation into the application
// AskResolutionPort; transport and adapters never import this module.

import {
  getAuthorityForPendingAsk as capekGetAuthorityForPendingAsk,
  getSessionIdForPendingAsk as capekGetSessionIdForPendingAsk,
  resolveAsk as capekResolveAsk,
} from '@capekai/core/ask-authority';
import type { AskResolutionPort } from '@/application/ports/ask-resolution';
import { withJean2ComposedScopeSync } from './execution-scope';

export const prokopAskResolution: AskResolutionPort = {
  resolveAsk(toolCallId, response, requestId) {
    return withJean2ComposedScopeSync(() =>
      capekResolveAsk(toolCallId, response, requestId));
  },
  async getSessionIdForPendingAsk(toolCallId, requestId) {
    return withJean2ComposedScopeSync(() =>
      capekGetSessionIdForPendingAsk(toolCallId, requestId));
  },
  getAuthorityForPendingAsk(toolCallId) {
    return withJean2ComposedScopeSync(() =>
      capekGetAuthorityForPendingAsk(toolCallId));
  },
};
