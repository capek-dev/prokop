import { logCodexPermissionDenial } from './permission-diagnostics';
import { logHarness, StderrTail } from '@/harnesses/shared/diagnostics';

/** Codex app-server stdio transport. Only the server spawns the installed CLI. */
export interface CodexConnection {
  stdout: ReadableStream<Uint8Array>;
  stdin: { write(data: Uint8Array): number | Promise<number> };
  exited: Promise<number>;
  kill(): void;
  /** Last stderr output, for failure logs only. */
  stderrTail?(): string | undefined;
}

export type CodexNotification = { method: string; params: unknown };

export class CodexRequestError extends Error {
  /**
   * Upstream error text for the server log. Wire errors never include it.
   */
  readonly detail?: string;

  constructor(readonly code: number | null, detail?: string) {
    super('Codex request rejected');
    if (detail) this.detail = detail;
  }
}

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function spawnCodexAppServer(args: string[] = [], env?: Record<string, string | undefined>): CodexConnection {
  const process = Bun.spawn(['codex', 'app-server', '--stdio', ...args], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true, ...(env ? { env } : {}),
  });
  if (!process.stdin || !process.stdout || typeof process.stdin === 'number'
    || typeof process.stdout === 'number') {
    process.kill();
    throw new Error('Codex stdio is unavailable');
  }
  const stderr = new StderrTail();
  if (process.stderr && typeof process.stderr !== 'number') {
    void (async () => {
      const decoder = new TextDecoder();
      for await (const chunk of process.stderr as ReadableStream<Uint8Array>) stderr.push(decoder.decode(chunk, { stream: true }));
    })().catch(() => {});
  }
  let killed = false;
  void process.exited.then((code) => {
    if (!killed) logHarness('codex-cli', 'app-server exited unexpectedly', { code, stderr: stderr.read() });
  }, () => {});
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    exited: process.exited,
    kill: () => {
      killed = true;
      process.kill();
    },
    stderrTail: () => stderr.read(),
  };
}

/**
 * Request IDs are connection-local. A server request is never implicitly
 * approved, even if its method is not understood by this client.
 */
export class CodexAppServer {
  private nextId = 1;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly pending = new Map<number, {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private readonly encoder = new TextEncoder();
  private closed = false;
  readonly disconnected: Promise<never>;
  private rejectDisconnected!: (error: Error) => void;
  private readonly reading: Promise<void>;

  constructor(
    private readonly io: CodexConnection,
    private readonly onNotification: (notification: CodexNotification) => void,
    private readonly onApproval?: (method: string, params: unknown) => Promise<{ decision: 'accept' | 'decline' }>,
    private readonly onToolCall?: (params: unknown) => Promise<{ contentItems: Array<{ type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }>; success: boolean }>,
    private readonly dynamicToolsEnabled = false,
  ) {
    this.disconnected = new Promise<never>((_resolve, reject) => { this.rejectDisconnected = reject; });
    void this.disconnected.catch(() => {});
    this.reading = this.read();
    void io.exited.then(() => this.fail(new Error('Codex app-server exited')),
      () => this.fail(new Error('Codex app-server exited')));
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'prokop', title: 'Prokop', version: '0.1.0' },
      capabilities: this.dynamicToolsEnabled
        ? { experimentalApi: true, requestAttestation: false }
        : null,
    });
    await this.write({ method: 'initialized', params: {} });
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex app-server is closed'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      void this.write({ method, params, id }).catch((error: unknown) => {
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          clearTimeout(entry.timer);
          entry.reject(error instanceof Error ? error : new Error('Codex request failed'));
        }
      });
    });
  }

  /** Last app-server stderr output, for failure logs. */
  stderrTail(): string | undefined {
    return this.io.stderrTail?.();
  }

  async close(): Promise<void> {
    this.fail(new Error('Codex app-server closed'));
    this.io.kill();
    await this.reading;
  }

  private async write(message: unknown): Promise<void> {
    if (this.closed) throw new Error('Codex app-server is closed');
    const bytes = this.encoder.encode(`${JSON.stringify(message)}\n`);
    const write = this.writeQueue.then(async () => {
      if (this.closed) throw new Error('Codex app-server is closed');
      await this.io.stdin.write(bytes);
    });
    this.writeQueue = write.catch(() => {});
    await write;
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectDisconnected(error);
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  private async read(): Promise<void> {
    const reader = this.io.stdout.getReader();
    let buffer = '';
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += this.decoder.decode(value, { stream: true });
        if (this.encoder.encode(buffer).byteLength > MAX_LINE_BYTES && !buffer.includes('\n')) {
          throw new Error('Codex message exceeds size limit');
        }
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (this.encoder.encode(line).byteLength > MAX_LINE_BYTES) {
            throw new Error('Codex message exceeds size limit');
          }
          if (line.trim()) this.receive(JSON.parse(line) as unknown);
          newline = buffer.indexOf('\n');
        }
      }
    } catch {
      // Never include protocol payloads or credentials in process errors.
    } finally {
      reader.releaseLock();
      this.fail(new Error('Codex app-server connection lost'));
      this.io.kill();
    }
  }

  private receive(raw: unknown): void {
    const message = record(raw);
    if (!message) throw new Error('Invalid Codex message');
    const id = message.id;
    if ((typeof id === 'number' || typeof id === 'string') && typeof message.method === 'string') {
      if (message.method === 'item/commandExecution/requestApproval'
        || message.method === 'item/fileChange/requestApproval') {
        void (this.onApproval?.(message.method, message.params) ?? Promise.resolve({ decision: 'decline' as const }))
          .catch(() => ({ decision: 'decline' as const }))
          .then(result => { if (!this.closed) void this.write({ id, result }); });
        return;
      }
      if (message.method === 'item/tool/call') {
        const denied = { contentItems: [{ type: 'inputText' as const, text: 'Tool unavailable' }], success: false };
        void (this.onToolCall?.(message.params) ?? Promise.resolve(denied))
          .catch(() => denied)
          .then(result => { if (!this.closed) void this.write({ id, result }).catch(() => {}); });
        return;
      }
      let result: unknown;
      switch (message.method) {
        case 'item/permissions/requestApproval':
          // This request bypasses the command/file approval callback.
          logCodexPermissionDenial('native', 'unsupported-permissions');
          result = { permissions: {}, scope: 'turn' };
          break;
        case 'mcpServer/elicitation/request':
          result = { action: 'decline', content: null, _meta: null };
          break;
        default:
          void this.write({ id, error: { code: -32601, message: 'Unsupported request' } });
          return;
      }
      void this.write({ id, result });
      return;
    }
    if (typeof id === 'number') {
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      if (message.error) {
        const code = record(message.error)?.code;
        const detail = record(message.error)?.message;
        pending.reject(new CodexRequestError(typeof code === 'number' && Number.isInteger(code) ? code : null,
          typeof detail === 'string' ? detail : undefined));
      } else if ('result' in message) pending.resolve(message.result);
      else pending.reject(new Error('Invalid Codex response'));
      return;
    }
    if (typeof message.method !== 'string' || !('params' in message)) {
      throw new Error('Invalid Codex notification');
    }
    this.onNotification({ method: message.method, params: message.params });
  }
}

export function codexObject(value: unknown): Record<string, unknown> | null {
  return record(value);
}
