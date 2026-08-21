import type { ClientConfig, ClientMessage, ConnectionState } from './types';
import type { ClientDescriptor } from './shared-protocol/client';
import { TypedEventEmitter } from './emitter';
import type { SdkEventMap } from './types/server-messages';
import { routeServerMessage } from './types/server-messages';
import { WebSocketTransport } from './transport/websocket';
import { HttpClient } from './transport/http';
import { SessionsNamespace } from './namespaces/sessions';
import { ChatNamespace } from './namespaces/chat';
import { PermissionsNamespace } from './namespaces/permissions';
import { QueueNamespace } from './namespaces/queue';
import { ProvidersNamespace } from './namespaces/providers';
import { ControlNamespace } from './namespaces/control';
import { TerminalNamespace } from './namespaces/terminal';
import { NotificationsNamespace } from './namespaces/notifications';
import { HttpNamespace } from './rest/http-namespace';

export class ProkopaiClient extends TypedEventEmitter<SdkEventMap> {
  private config: ClientConfig;
  private transport: WebSocketTransport;
  private _httpClient: HttpClient;
  private _state: ConnectionState = 'disconnected';
  private _connectionId: string | null = null;
  private _registeredClient: ClientDescriptor | null = null;

  readonly sessions: SessionsNamespace;
  readonly chat: ChatNamespace;
  readonly permissions: PermissionsNamespace;
  readonly queue: QueueNamespace;
  readonly providers: ProvidersNamespace;
  readonly control: ControlNamespace;
  readonly notifications: NotificationsNamespace;
  readonly http: HttpNamespace;
  readonly terminal: TerminalNamespace;

  constructor(config: ClientConfig) {
    super();
    this.config = config;
    this.transport = new WebSocketTransport({
      url: config.url,
      token: config.token,
      wsConstructor: config.wsConstructor,
      connectionTimeout: config.connectionTimeout,
    });
    this._httpClient = new HttpClient({
      url: config.url,
      token: config.token,
      apiBase: config.apiBase,
    });

    const send = this.transport.send.bind(this.transport);
    this.sessions = new SessionsNamespace(send);
    this.chat = new ChatNamespace(send);
    this.permissions = new PermissionsNamespace(send);
    this.queue = new QueueNamespace(send);
    this.providers = new ProvidersNamespace(send);
    this.control = new ControlNamespace(send);
    this.notifications = new NotificationsNamespace(send);
    this.http = new HttpNamespace(this._httpClient);
    this.terminal = new TerminalNamespace({
      url: config.url,
      token: config.token,
      wsConstructor: config.wsConstructor,
    });

    this.transport.onOpen = () => {
      this._state = 'connected';
      this._connectionId = null;
      this._registeredClient = null;

      if (this.config.clientDescriptor) {
        this.send({
          type: 'client.register',
          client: this.config.clientDescriptor,
        });
      }

      this.emit('connected');
      this.emit('*', { source: 'lifecycle', type: 'connected', payload: undefined });
    };

    this.transport.onMessage = (msg) => {
      if (msg.type === 'client.registered') {
        this._connectionId = msg.connectionId;
        this._registeredClient = msg.client;
      }
      routeServerMessage(this, msg);
    };

    this.transport.onClose = (code, reason, wasClean) => {
      const prevState = this._state;
      this._state = 'disconnected';
      if (prevState !== 'disconnected') {
        this.emit('disconnected', { code, reason, wasClean });
        this.emit('*', { source: 'lifecycle', type: 'disconnected', payload: { code, reason, wasClean } });
      }
    };

    this.transport.onError = (error) => {
      this.emit('error.connection', error);
      this.emit('*', { source: 'lifecycle', type: 'error.connection', payload: error });
    };
  }

  async connect(): Promise<void> {
    this._state = 'connecting';
    await this.transport.connect();
    // Note: Interactive permission prompts are now handled via ask.* protocol
    // Client should listen for 'ask.request' events to handle permission asks
  }

  async disconnect(): Promise<void> {
    this._state = 'disconnecting';
    await this.transport.disconnect();
  }

  async dispose(): Promise<void> {
    await this.disconnect();
    this.transport.dispose();
    this.removeAllListeners();
  }

  get state(): ConnectionState {
    return this._state;
  }

  get connected(): boolean {
    return this._state === 'connected';
  }

  get ws(): WebSocket | null {
    return this.transport.ws;
  }

  get httpClient(): HttpClient {
    return this._httpClient;
  }

  get connectionId(): string | null {
    return this._connectionId;
  }

  get registeredClient(): ClientDescriptor | null {
    return this._registeredClient;
  }

  get clientId(): string | null {
    return this._registeredClient?.clientId ?? null;
  }

  send(message: ClientMessage): void {
    this.transport.send(message);
  }
}
