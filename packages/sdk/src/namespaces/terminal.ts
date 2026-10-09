import type { TerminalEvent, TerminalSessionInit, TerminalSessionInfo } from '../shared';
import { socketAuthQuery } from '../pairing';
import { ConnectionError } from '../errors';
import { TypedEventEmitter } from '../emitter';

export const TERMINAL_OPCODES = {
  INPUT: 0x01,
  RESIZE: 0x02,
  CLOSE: 0x03,
  OUTPUT: 0x04,
  EXIT: 0x05,
  ERROR: 0x06,
  INIT_ACK: 0x07,
  TITLE: 0x08,
  REPLAY_COMPLETE: 0x09,
} as const;

export type TerminalOpcode = typeof TERMINAL_OPCODES[keyof typeof TERMINAL_OPCODES];

export interface TerminalEventMap {
  [key: string]: unknown[];

  output: [data: Uint8Array];
  exit: [exitCode: number];
  title: [title: string];
  replay_complete: [];
  close: [];
  error: [error: Error];
}

export interface TerminalEventsEventMap {
  [key: string]: unknown[];

  snapshot: [sessions: TerminalSessionInfo[]];
  created: [session: TerminalSessionInfo];
  destroyed: [sessionId: string];
  exited: [sessionId: string, exitCode: number];
  title_changed: [sessionId: string, title: string];
  status_changed: [sessionId: string, status: 'running' | 'exited'];
  close: [];
  error: [error: Error];
}

function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = opcode;
  frame.set(payload, 1);
  return frame;
}

export class TerminalConnection extends TypedEventEmitter<TerminalEventMap> {
  private ws: WebSocket;
  private _session: TerminalSessionInit;
  private _closed = false;
  private _disposed = false;
  private _preInitOutput: Uint8Array[] = [];
  private _pendingReplayComplete = false;

  constructor(ws: WebSocket, session: TerminalSessionInit, preInitOutput?: Uint8Array[]) {
    super();
    this.ws = ws;
    this._session = session;
    if (preInitOutput) {
      this._preInitOutput = preInitOutput;
    }

    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
    this.ws.onerror = this.handleError.bind(this);
  }

  override on<K extends keyof TerminalEventMap & string>(
    event: K,
    handler: (...args: TerminalEventMap[K]) => void
  ): this {
    const result = super.on(event, handler);
    if (event === 'output') {
      this.flushPreInitOutput();
    } else if (event === 'replay_complete' && this._pendingReplayComplete) {
      this._pendingReplayComplete = false;
      this.emit('replay_complete');
    }
    return result;
  }

  private flushPreInitOutput(): void {
    if (this._preInitOutput.length === 0) return;
    const frames = this._preInitOutput;
    this._preInitOutput = [];
    for (const payload of frames) {
      if (this._closed) break;
      this.emit('output', payload);
    }
  }

  protected handleMessage(event: MessageEvent): void {
    if (this._closed) return;

    const data = new Uint8Array(event.data);
    if (data.length < 1) return;

    const opcode = data[0] as TerminalOpcode;
    const payload = data.slice(1);

    switch (opcode) {
      case TERMINAL_OPCODES.OUTPUT:
        if (this.listenerCount('output') > 0) {
          this.emit('output', payload);
        } else {
          this._preInitOutput.push(payload);
        }
        break;

      case TERMINAL_OPCODES.EXIT: {
        let exitCode = 0;
        if (payload.length > 0) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as { exitCode: unknown };
            exitCode = typeof parsed.exitCode === 'number' ? parsed.exitCode : 0;
          } catch {
            exitCode = 0;
          }
        }
        this._session = { ...this._session, status: 'exited', exitCode };
        this.emit('exit', exitCode);
        break;
      }

      case TERMINAL_OPCODES.TITLE: {
        let title = 'Terminal';
        if (payload.length > 0) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as { title: unknown };
            title = typeof parsed.title === 'string' ? parsed.title : 'Terminal';
          } catch {
            title = 'Terminal';
          }
        }
        this._session = { ...this._session, title };
        this.emit('title', title);
        break;
      }

      case TERMINAL_OPCODES.REPLAY_COMPLETE:
        if (this.listenerCount('replay_complete') > 0) {
          this.emit('replay_complete');
        } else {
          this._pendingReplayComplete = true;
        }
        break;

      case TERMINAL_OPCODES.ERROR: {
        const errorMessage = new TextDecoder().decode(payload);
        const error = new Error(errorMessage || 'Terminal error');
        this.emit('error', error);
        break;
      }

      case TERMINAL_OPCODES.CLOSE:
        this.doClose();
        break;

      default:
        break;
    }
  }

  private handleClose(_event: CloseEvent): void {
    if (!this._closed) {
      this._closed = true;
      this.emit('close');
    }
  }

  private handleError(): void {
    if (!this._closed) {
      const error = new Error('WebSocket error');
      this.emit('error', error);
    }
  }

  private doClose(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this.ws.close(1000, 'Client close');
    } catch {
      // Ignore close errors
    }
    this.emit('close');
    this.cleanupHandlers();
  }

  private cleanupHandlers(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.ws.onmessage = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
  }

  dispatchFrame(data: Uint8Array): void {
    this.handleMessage({ data: data.buffer as ArrayBuffer } as MessageEvent);
  }

  write(data: string | Uint8Array): void {
    if (this._closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;

    let bytes: Uint8Array;
    if (typeof data === 'string') {
      bytes = new TextEncoder().encode(data);
    } else {
      bytes = data;
    }

    this.ws.send(encodeFrame(TERMINAL_OPCODES.INPUT, bytes));
  }

  resize(cols: number, rows: number): void {
    if (this._closed) return;
    if (this.ws.readyState !== WebSocket.OPEN) return;

    const jsonPayload = JSON.stringify({ cols, rows });
    const payload = new TextEncoder().encode(jsonPayload);
    this.ws.send(encodeFrame(TERMINAL_OPCODES.RESIZE, payload));
  }

  close(): void {
    if (this._closed) return;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeFrame(TERMINAL_OPCODES.CLOSE, new Uint8Array(0)));
    }
    this.doClose();
  }

  dispose(): void {
    this.cleanupHandlers();
    if (!this._closed) {
      this._closed = true;
      try {
        this.ws.close(1000, 'Disposed');
      } catch {
        // Ignore close errors
      }
    }
    this.removeAllListeners();
  }

  get session(): TerminalSessionInit {
    return this._session;
  }

  get sessionId(): string {
    return this._session.sessionId;
  }

  get pid(): number {
    return this._session.pid;
  }

  get cwd(): string {
    return this._session.cwd;
  }

  get shell(): string {
    return this._session.shell;
  }

  get cols(): number {
    return this._session.cols;
  }

  get rows(): number {
    return this._session.rows;
  }

  get title(): string {
    return this._session.title;
  }

  get status(): 'running' | 'exited' {
    return this._session.status;
  }

  get exitCode(): number | null {
    return this._session.exitCode;
  }

  get isReconnect(): boolean {
    return this._session.isReconnect;
  }

  get closed(): boolean {
    return this._closed;
  }
}

export class TerminalEventsConnection extends TypedEventEmitter<TerminalEventsEventMap> {
  private ws: WebSocket;
  private _closed = false;
  private _disposed = false;

  constructor(ws: WebSocket) {
    super();
    this.ws = ws;

    this.ws.onmessage = this.handleMessage.bind(this);
    this.ws.onclose = this.handleClose.bind(this);
    this.ws.onerror = this.handleError.bind(this);
  }

  private handleMessage(event: MessageEvent): void {
    if (this._closed) return;

    const data = event.data;
    if (typeof data !== 'string') return;

    let parsed: TerminalEvent;
    try {
      parsed = JSON.parse(data) as TerminalEvent;
    } catch {
      return;
    }

    switch (parsed.type) {
      case 'snapshot':
        this.emit('snapshot', parsed.sessions);
        break;

      case 'created':
        this.emit('created', parsed.session);
        break;

      case 'destroyed':
        this.emit('destroyed', parsed.sessionId);
        break;

      case 'exited':
        this.emit('exited', parsed.sessionId, parsed.exitCode);
        break;

      case 'title_changed':
        this.emit('title_changed', parsed.sessionId, parsed.title);
        break;

      case 'status_changed':
        this.emit('status_changed', parsed.sessionId, parsed.status);
        break;
    }
  }

  private handleClose(_event: CloseEvent): void {
    if (!this._closed) {
      this._closed = true;
      this.emit('close');
    }
  }

  private handleError(): void {
    if (!this._closed) {
      const error = new Error('WebSocket error');
      this.emit('error', error);
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this.ws.close(1000, 'Client close');
    } catch {
      // Ignore close errors
    }
    this.cleanupHandlers();
  }

  dispose(): void {
    this.cleanupHandlers();
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      try {
        this.ws.close(1000, 'Disposed');
      } catch {
        // Ignore close errors
      }
    }
    if (!this._closed) {
      this._closed = true;
      this.emit('close');
    }
    this.removeAllListeners();
  }

  private cleanupHandlers(): void {
    if (this._disposed) return;
    this._disposed = true;
    this.ws.onmessage = null;
    this.ws.onclose = null;
    this.ws.onerror = null;
  }

  get closed(): boolean {
    return this._closed;
  }
}

export interface TerminalConnectOptions {
  workspaceId: string;
  cwd: string;
  shell?: string;
  sessionId?: string;
}

export interface TerminalConfig {
  url: string;
  token?: string;
  wsConstructor?: typeof WebSocket;
  connectTimeout?: number;
}

export interface TerminalEventsSubscription {
  conn: TerminalEventsConnection;
  initialSessions: TerminalSessionInfo[];
}

export class TerminalNamespace {
  private config: TerminalConfig;

  constructor(config: TerminalConfig) {
    this.config = {
      connectTimeout: 10000,
      ...config,
    };
  }

  async connect(options: TerminalConnectOptions): Promise<TerminalConnection> {
    const WsConstructor = this.config.wsConstructor ?? globalThis.WebSocket;
    const proto = this.config.url.startsWith('https') ? 'wss' : 'ws';
    const clean = this.config.url.replace(/^https?:\/\//, '');

    const params = new URLSearchParams({
      cwd: options.cwd,
      workspaceId: options.workspaceId,
      ...await socketAuthQuery(this.config.url, this.config.token),
    });

    if (options.shell) params.set('shell', options.shell);
    if (options.sessionId) params.set('sessionId', options.sessionId);

    const wsUrl = `${proto}://${clean}/ws/terminal?${params.toString()}`;

    return new Promise((resolve, reject) => {
      const ws = new WsConstructor(wsUrl);
      ws.binaryType = 'arraybuffer';
      const timeout = this.config.connectTimeout ?? 10000;
      let resolved = false;

      const doResolve = (conn: TerminalConnection) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(conn);
        }
      };

      const doReject = (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      };

      const timeoutId = setTimeout(() => {
        ws.close();
        doReject(new ConnectionError(`Terminal connection timeout (${timeout}ms)`));
      }, timeout);

      ws.onopen = () => {
        // Waiting for INIT_ACK or ERROR
      };

      // Buffer all frames received before INIT_ACK
      const preInitFrames: Array<{ opcode: number; data: Uint8Array }> = [];

      ws.onmessage = (event: MessageEvent) => {
        const data = new Uint8Array(event.data);
        if (data.length < 1) return;
        const opcode = data[0];
        const payload = data.slice(1);

        if (opcode === TERMINAL_OPCODES.INIT_ACK) {
          try {
            const init = JSON.parse(
              new TextDecoder().decode(payload),
            ) as TerminalSessionInit;

            // Extract OUTPUT payloads to pass to connection (flushed lazily on 'output' listener)
            const outputPayloads = preInitFrames
              .filter(f => f.opcode === TERMINAL_OPCODES.OUTPUT)
              .map(f => f.data);

            const conn = new TerminalConnection(ws, init, outputPayloads);

            // Dispatch non-OUTPUT buffered frames through handleMessage directly
            for (const frame of preInitFrames) {
              if (frame.opcode !== TERMINAL_OPCODES.OUTPUT) {
                conn.dispatchFrame(frame.data);
              }
            }

            doResolve(conn);
          } catch (err: unknown) {
            ws.close();
            const message = err instanceof Error ? err.message : String(err);
            doReject(new ConnectionError(`Failed to parse terminal init: ${message}`));
          }
        } else if (opcode === TERMINAL_OPCODES.ERROR) {
          ws.close();
          let errorMessage = 'Terminal connection failed';
          try {
            const parsed = JSON.parse(new TextDecoder().decode(payload)) as { message?: string };
            errorMessage = parsed.message || errorMessage;
          } catch {
            // Use default message
          }
          doReject(new ConnectionError(errorMessage));
        } else {
          // Buffer ALL other frames for replay after TerminalConnection is created
          preInitFrames.push({ opcode, data });
        }
      };

      ws.onerror = () => {
        ws.close();
        doReject(new ConnectionError('Terminal WebSocket error'));
      };

      ws.onclose = () => {
        doReject(new ConnectionError('Terminal connection closed before init'));
      };
    });
  }

  async subscribeEvents(workspaceId: string): Promise<TerminalEventsSubscription> {
    const WsConstructor = this.config.wsConstructor ?? globalThis.WebSocket;
    const proto = this.config.url.startsWith('https') ? 'wss' : 'ws';
    const clean = this.config.url.replace(/^https?:\/\//, '');

    const params = new URLSearchParams({
      workspaceId,
      ...await socketAuthQuery(this.config.url, this.config.token),
    });


    const wsUrl = `${proto}://${clean}/ws/terminal/events?${params.toString()}`;

    return new Promise((resolve, reject) => {
      const ws = new WsConstructor(wsUrl);
      const timeout = this.config.connectTimeout ?? 10000;
      let resolved = false;

      const doResolve = (subscription: TerminalEventsSubscription) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          resolve(subscription);
        }
      };

      const doReject = (err: Error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          reject(err);
        }
      };

      const timeoutId = setTimeout(() => {
        ws.close();
        doReject(new ConnectionError(`Terminal events subscription timeout (${timeout}ms)`));
      }, timeout);

      ws.onopen = () => {
        // Waiting for first snapshot message
      };

      let conn: TerminalEventsConnection | null = null;

      ws.onmessage = (event: MessageEvent) => {
        if (resolved) return;

        const data = event.data;
        if (typeof data !== 'string') return;

        let parsed: TerminalEvent;
        try {
          parsed = JSON.parse(data) as TerminalEvent;
        } catch {
          return;
        }

        if (parsed.type === 'snapshot') {
          if (!conn) {
            conn = new TerminalEventsConnection(ws);
          }
          doResolve({ conn, initialSessions: parsed.sessions });
        }
      };

      ws.onerror = () => {
        ws.close();
        doReject(new ConnectionError('Terminal events WebSocket error'));
      };

      ws.onclose = () => {
        if (!resolved) {
          doReject(new ConnectionError('Terminal events connection closed before snapshot'));
        }
      };
    });
  }
}
