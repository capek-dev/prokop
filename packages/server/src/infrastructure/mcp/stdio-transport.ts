import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import { getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ChildProcess } from 'node:child_process';
import spawn from 'cross-spawn';
import { PassThrough } from 'node:stream';

export class StdioTransport implements Transport {
  private _process?: ChildProcess;
  private _readBuffer = new ReadBuffer();
  private _serverParams: StdioServerParameters;
  private _stderrStream: PassThrough | null = null;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  constructor(server: StdioServerParameters) {
    this._serverParams = server;
    if (server.stderr === 'pipe' || server.stderr === 'overlapped') {
      this._stderrStream = new PassThrough();
    }
  }

  async start(): Promise<void> {
    if (this._process) {
      throw new Error(
        'StdioTransport already started! If using Client class, note that connect() calls start() automatically.'
      );
    }

    const childProcess: ChildProcess = spawn(this._serverParams.command, this._serverParams.args ?? [], {
      env: {
        ...getDefaultEnvironment(),
        ...this._serverParams.env,
      },
      stdio: ['pipe', 'pipe', this._serverParams.stderr ?? 'inherit'],
      shell: false,
      windowsHide: process.platform === 'win32',
      cwd: this._serverParams.cwd,
    });

    this._process = childProcess;

    return new Promise((resolve, reject) => {
      childProcess.on('error', (error: Error) => {
        reject(error);
        this.onerror?.(error);
      });

      childProcess.on('spawn', () => {
        resolve();
      });

      childProcess.on('close', () => {
        this._process = undefined;
        this.onclose?.();
      });

      childProcess.stdin?.on('error', (error: Error) => {
        this.onerror?.(error);
      });

      childProcess.stdout?.on('data', (chunk: Buffer) => {
        this._readBuffer.append(chunk);
        this.processReadBuffer();
      });

      childProcess.stdout?.on('error', (error: Error) => {
        this.onerror?.(error);
      });

      if (this._stderrStream && childProcess.stderr) {
        childProcess.stderr.pipe(this._stderrStream);
      }
    });
  }

  get stderr(): PassThrough | null {
    if (this._stderrStream) {
      return this._stderrStream;
    }
    return (this._process?.stderr as PassThrough) ?? null;
  }

  get pid(): number | null {
    return this._process?.pid ?? null;
  }

  private processReadBuffer(): void {
    while (true) {
      try {
        const message = this._readBuffer.readMessage();
        if (message === null) {
          break;
        }
        this.onmessage?.(message);
      } catch (error) {
        this.onerror?.(error as Error);
      }
    }
  }

  async close(): Promise<void> {
    if (this._process) {
      const processToClose = this._process;
      this._process = undefined;

      const closePromise = new Promise<void>((resolve) => {
        processToClose.once('close', () => {
          resolve();
        });
      });

      try {
        processToClose.stdin?.end();
      } catch {
        // ignore
      }

      await Promise.race([
        closePromise,
        new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
      ]);

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGTERM');
        } catch {
          // ignore
        }

        await Promise.race([
          closePromise,
          new Promise((resolve) => setTimeout(resolve, 2_000).unref()),
        ]);
      }

      if (processToClose.exitCode === null) {
        try {
          processToClose.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }

    this._readBuffer.clear();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve) => {
      if (!this._process?.stdin) {
        throw new Error('Not connected');
      }

      const json = serializeMessage(message);
      if (this._process.stdin.write(json)) {
        resolve();
      } else {
        this._process.stdin.once('drain', resolve);
      }
    });
  }
}
