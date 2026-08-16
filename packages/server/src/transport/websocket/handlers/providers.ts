import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { requireWireApplication } from '../application';
import type { ProviderConnectMessage, ProviderDisconnectMessage } from '@jean2/sdk';

/**
 * Provider wire handlers (S4). The provider account and OAuth use cases
 * live in the providers application behind the registry and OAuth ports;
 * these handlers only map outcomes to the exact wire broadcast/error
 * shapes.
 */
export async function handleProviderConnect(
  ctx: RouterContext<ConnectionId>,
  _ws: ConnectionId,
  msg: ProviderConnectMessage,
): Promise<void> {
  try {
    const { result, status } = await requireWireApplication().providers.connect(
      msg.provider,
      {
        redirectStrategy: msg.redirectStrategy as 'client_redirect' | 'manual_paste' | 'server_callback' | undefined,
      },
    );
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
    await requireWireApplication().providers.disconnect(msg.provider);
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
