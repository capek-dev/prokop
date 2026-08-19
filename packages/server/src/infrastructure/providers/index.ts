import './codex';
import './gmail';
import {
  startGmailProviderLifecycle,
  stopGmailBackgroundRefresh,
} from './gmail';
import { disposeOAuthFlows } from '../oauth/oauth-manager';

export {
  registerOAuthConfig,
  initiateOAuthFlow,
  completeOAuthFlow,
  handleServerCallback,
  refreshTokens,
} from '../oauth/oauth-manager';

export function startProviderAccountLifecycle(): void {
  startGmailProviderLifecycle();
}

export function stopProviderAccountLifecycle(): void {
  stopGmailBackgroundRefresh();
  disposeOAuthFlows();
}
