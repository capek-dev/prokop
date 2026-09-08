import type { ClientMessage, ServerMessage } from '../shared';
import { ConnectionError } from '../errors';

export interface WebSocketTransportConfig {
  url: string;
  token?: string;
  wsConstructor?: typeof WebSocket;
  connectionTimeout?: number;
}

export type WsState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export class WebSocketTransport {
  private _ws: WebSocket | null = null;
  private config: WebSocketTransportConfig;
  private _state: WsState = 'disconnected';
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private lastMessageAt = 0;
  private static readonly HEARTBEAT_TIMEOUT_MS = 90_000;

  onOpen: (() => void) | null = null;
  onMessage: ((message: ServerMessage) => void) | null = null;
  onClose: ((code: number, reason: string, wasClean: boolean) => void) | null = null;
  onError: ((error: Error) => void) | null = null;

  constructor(config: WebSocketTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.closeSocket(1000, 'Connection replaced', false);
    return new Promise((resolve, reject) => {
      const WsConstructor = this.config.wsConstructor ?? globalThis.WebSocket;
      let ws: WebSocket;
      try {
        ws = new WsConstructor(this.buildWsUrl());
      } catch (error: unknown) {
        reject(error);
        return;
      }
      this._ws = ws;
      this._state = 'connecting';
      this.rejectConnect = reject;
      const timeoutMs = this.config.connectionTimeout ?? 10000;
      this.connectionTimer = setTimeout(() => {
        if (this._ws !== ws) return;
        this.closeSocket(1000, `Connection timeout (${timeoutMs}ms)`, true);
      }, timeoutMs);

      ws.onopen = () => {
        if (this._ws !== ws) return;
        this.clearConnectionTimer();
        this.rejectConnect = null;
        this._state = 'connected';
        this.resetHeartbeat();
        resolve();
        this.onOpen?.();
      };
      ws.onmessage = (event: MessageEvent) => {
        if (this._ws !== ws) return;
        try {
          const message = JSON.parse(String(event.data)) as ServerMessage;
          this.resetHeartbeat();
          if (message.type === 'ping') {
            this.send({ type: 'pong' } as unknown as ClientMessage);
            return;
          }
          this.onMessage?.(message);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          this.onError?.(new Error(`Failed to parse WebSocket message: ${message}`));
        }
      };
      ws.onclose = (event: CloseEvent) => {
        if (this._ws !== ws) return;
        this.releaseSocket(event.reason || 'Connection closed');
        this.onClose?.(event.code, event.reason, event.wasClean);
      };
      ws.onerror = () => {
        if (this._ws !== ws) return;
        this.closeSocket(1000, 'WebSocket error', true);
        this.onError?.(new ConnectionError('WebSocket error'));
      };
    });
  }

  send(message: ClientMessage): void {
    if (!this._ws || this._ws.readyState !== 1) {
      throw new ConnectionError('WebSocket is not connected');
    }
    this._ws.send(JSON.stringify(message));
  }

  async disconnect(): Promise<void> {
    this.closeSocket(1000, 'Client disconnect', true);
  }

  dispose(): void {
    this.onOpen = null;
    this.onMessage = null;
    this.onClose = null;
    this.onError = null;
    this.closeSocket(1000, 'Client disposed', false);
  }

  get connected(): boolean {
    return this._state === 'connected';
  }

  get readyState(): number {
    return this._ws?.readyState ?? 3;
  }

  get ws(): WebSocket | null {
    return this._ws;
  }

  /** Also checked on foreground return, when browser timers may have been suspended. */
  checkConnectionFreshness(): boolean {
    if (!this.connected) return false;
    if (Date.now() - this.lastMessageAt >= WebSocketTransport.HEARTBEAT_TIMEOUT_MS) {
      this.closeSocket(1000, 'Heartbeat timeout', true);
      return false;
    }
    return true;
  }

  private resetHeartbeat(): void {
    this.lastMessageAt = Date.now();
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      this.checkConnectionFreshness();
    }, WebSocketTransport.HEARTBEAT_TIMEOUT_MS);
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer !== null) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }

  private releaseSocket(reason: string): WebSocket | null {
    const ws = this._ws;
    this._ws = null;
    this._state = 'disconnected';
    this.clearConnectionTimer();
    if (this.heartbeatTimer !== null) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.rejectConnect?.(new ConnectionError(reason));
    this.rejectConnect = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
    }
    return ws;
  }

  private closeSocket(code: number, reason: string, notify: boolean): void {
    const ws = this.releaseSocket(reason);
    if (!ws) return;
    try {
      ws.close(code, reason);
    } finally {
      // Local cancellation must not wait for a potentially stalled close handshake.
      if (notify) this.onClose?.(code, reason, false);
    }
  }

  private buildWsUrl(): string {
    const proto = this.config.url.startsWith('https') ? 'wss' : 'ws';
    const clean = this.config.url.replace(/^https?:\/\//, '');
    if (this.config.token) {
      return `${proto}://${clean}/ws?token=${encodeURIComponent(this.config.token)}`;
    }
    return `${proto}://${clean}/ws`;
  }
}
