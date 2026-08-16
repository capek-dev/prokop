import {
  completeOAuthFlow,
  handleServerCallback,
  initiateOAuthFlow,
} from '@/providers/oauth-manager';
import type {
  OAuthFlowPort,
  OAuthServerCallbackResult,
} from '@/application/ports/provider-accounts';

/**
 * Jean2 OAuth flow adapter (S5). Wraps the current OAuth manager
 * (pending-flow tracking, token exchange, localhost callback server, HTML
 * pages) with its exact identities; the manager consumes the provider-
 * accounts domain policy for PKCE, URL construction, and token configs.
 */
export function createJean2OAuthFlowPort(): OAuthFlowPort {
  return {
    initiate(providerId, redirectStrategy) {
      return initiateOAuthFlow(providerId, redirectStrategy);
    },

    complete(flowId, code, state, redirectUri) {
      return completeOAuthFlow(flowId, code, state, redirectUri);
    },

    async serverCallback(providerId, url): Promise<OAuthServerCallbackResult> {
      const response = await handleServerCallback(providerId, url);
      const body = await response.text();
      return {
        body,
        status: response.status,
        contentType: response.headers.get('Content-Type') ?? 'text/html; charset=utf-8',
      };
    },
  };
}
