// =============================================================================
// Prokop Browser Client
//
// Wraps the SDK client for the Chrome extension environment.
// Uses a custom WebSocket constructor backed by Chrome's WebSocket API.
//
// The extension does NOT need to join sessions. With 'global' visibility scope
// for client_capability asks, delivery is based on registered client
// capabilities, not session participation.
// =============================================================================

import { ProkopaiClient } from '@prokopai/sdk';
import type { ClientDescriptor } from '@prokopai/sdk';
import type { ExtensionConfig } from './types';

export type AskRequestHandler = (
  sessionId: string,
  toolCallId: string,
  toolName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ask: any,
  requestId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authority?: any,
) => void;

export type DisconnectHandler = (code: number, reason: string, wasClean: boolean) => void;

const EXTENSION_CAPABILITIES = [
  'browser_automation',
  'active_tab_read',
  'browser_dom_action',
  'browser_navigate',
  'browser_screenshot',
  'browser_discover_elements',
  'browser_tab_manage',
] as const;

export class BrowserClient {
  private client: ProkopaiClient | null = null;
  private askHandler: AskRequestHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  onAskRequest(handler: AskRequestHandler): void {
    this.askHandler = handler;
  }

  onDisconnected(handler: DisconnectHandler): void {
    this.disconnectHandler = handler;
  }

  async connect(config: ExtensionConfig, clientId: string): Promise<void> {
    const descriptor: ClientDescriptor = {
      clientId,
      clientType: 'extension',
      displayName: 'Prokop Browser',
      interactionMode: 'headless',
      capabilities: [...EXTENSION_CAPABILITIES],
    };

    this.client = new ProkopaiClient({
      url: config.serverUrl,
      token: config.token ?? '',
      clientDescriptor: descriptor,
      wsConstructor: WebSocket,
    });

    this.client.on('connected', () => {
      this._connected = true;
      console.log('[browser] Connected to Prokopai server');
    });

    this.client.on('disconnected', ({ code, reason, wasClean }) => {
      this._connected = false;
      console.log('[browser] Disconnected from Prokopai server:', code, reason);
      this.disconnectHandler?.(code, reason, wasClean);
    });

    this.client.on('error.connection', (error) => {
      console.error('[browser] Connection error:', error);
    });

    this.client.on('ask.request', (sessionId, toolCallId, toolName, ask, requestId, authority) => {
      if (this.askHandler) {
        this.askHandler(sessionId, toolCallId, toolName, ask, requestId, authority);
      }
    });

    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
      this._connected = false;
    }
  }

  get clientId(): string | null {
    return this.client?.clientId ?? null;
  }

  sendAskResponse(toolCallId: string, response: Record<string, unknown>, requestId?: string): void {
    if (!this.client) return;
    this.client.send({
      type: 'ask.response',
      toolCallId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response: response as any,
      requestId,
    });
  }
}
