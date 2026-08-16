import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { connectProvider, disconnectProvider, getProviderStatus } from '@capekai/core/compat/jean2';
import type { ProviderConnectMessage, ProviderDisconnectMessage } from '@jean2/sdk';

export async function handleProviderConnect(
  ctx: RouterContext<ConnectionId>,
  _ws: ConnectionId,
  msg: ProviderConnectMessage,
): Promise<void> {
  try {
    const result = await connectProvider(msg.provider, {
      redirectStrategy: msg.redirectStrategy as 'client_redirect' | 'manual_paste' | 'server_callback' | undefined,
    });
    const status = await getProviderStatus(msg.provider);
    ctx.broadcast({
      type: 'provider.status',
      provider: msg.provider,
      connected: status.connected,
      authorizationUrl: result.authorizationUrl,
      flowId: result.flowId,
      redirectStrategy: result.redirectStrategy,
      redirectUri: result.redirectUri,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to connect provider';
    ctx.broadcast({
      type: 'provider.status',
      provider: msg.provider,
      connected: false,
      error: message,
    });
  }
}

export async function handleProviderDisconnect(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: ProviderDisconnectMessage,
): Promise<void> {
  try {
    await disconnectProvider(msg.provider);
    ctx.broadcast({
      type: 'provider.connected',
      provider: msg.provider,
      connected: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to disconnect provider';
    ctx.send(ws, { type: 'error', code: 'provider_error', message });
  }
}
