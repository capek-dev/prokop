import { spawn, ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerStatus {
  running: boolean;
  port: number;
}

export interface ServerStartResult {
  port: number;
}

export class ServerManager {
  private process: ChildProcess | null = null;
  private port = 3000;
  private serverBinaryPath: string | null = null;

  constructor() {
    this.serverBinaryPath = this.resolveServerPath();
  }

  private resolveServerPath(): string | null {
    // Try multiple locations for the server binary
    const possiblePaths = [
      // Packaged app resources
      join(process.resourcesPath || '', 'server', 'dist', 'index.js'),
      join(process.resourcesPath || '', 'server', 'index.js'),
      // Development path relative to electron package
      join(__dirname, '../../server/dist/index.js'),
      join(__dirname, '../../../server/dist/index.js'),
      // Direct path
      join(app.getAppPath(), '../server/dist/index.js'),
    ];

    for (const path of possiblePaths) {
      try {
        // Check if file exists (this is a sync check, but sufficient for our purposes)
        const fs = require('fs');
        if (fs.existsSync(path)) {
          console.log(`[ServerManager] Found server at: ${path}`);
          return path;
        }
      } catch {
        // Continue to next path
      }
    }

    console.warn('[ServerManager] Server binary not found in any expected location');
    return null;
  }

  async start(): Promise<ServerStartResult> {
    if (this.process) {
      console.log('[ServerManager] Server already running');
      return { port: this.port };
    }

    if (!this.serverBinaryPath) {
      console.warn('[ServerManager] Cannot start server: binary not found');
      throw new Error('Server binary not found');
    }

    return new Promise((resolve, reject) => {
      try {
        console.log(`[ServerManager] Starting server from: ${this.serverBinaryPath}`);

        this.process = spawn('bun', [this.serverBinaryPath!, '--port', String(this.port)], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PROKOPAI_SERVER_PORT: String(this.port),
          },
        });

        this.process.stdout?.on('data', (data: Buffer) => {
          const output = data.toString().trim();
          console.log(`[ServerManager] stdout: ${output}`);

          // Parse port from output if needed
          const portMatch = output.match(/listening on.*:(\d+)/i) || output.match(/port.*?(\d+)/i);
          if (portMatch) {
            this.port = parseInt(portMatch[1], 10);
          }
        });

        this.process.stderr?.on('data', (data: Buffer) => {
          console.error(`[ServerManager] stderr: ${data.toString().trim()}`);
        });

        this.process.on('error', (err) => {
          console.error(`[ServerManager] Process error: ${err.message}`);
          this.process = null;
          reject(err);
        });

        this.process.on('exit', (code, signal) => {
          console.log(`[ServerManager] Process exited with code ${code}, signal ${signal}`);
          this.process = null;

          // Notify renderer of crash
          if (code !== 0 && code !== null) {
            this.notifyRendererOfCrash();
          }
        });

        // Give it a moment to start
        setTimeout(() => {
          resolve({ port: this.port });
        }, 1000);
      } catch (err) {
        console.error('[ServerManager] Failed to start server:', err);
        this.process = null;
        reject(err);
      }
    });
  }

  async stop(): Promise<void> {
    if (!this.process) {
      console.log('[ServerManager] Server not running');
      return;
    }

    return new Promise((resolve) => {
      console.log('[ServerManager] Stopping server...');

      // Try graceful shutdown first
      this.process?.kill('SIGTERM');

      // Force kill after timeout
      const timeout = setTimeout(() => {
        if (this.process) {
          console.log('[ServerManager] Force killing server process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process?.once('exit', () => {
        clearTimeout(timeout);
        this.process = null;
        console.log('[ServerManager] Server stopped');
        resolve();
      });
    });
  }

  status(): ServerStatus {
    return {
      running: this.process !== null && this.process.exitCode === null,
      port: this.port,
    };
  }

  private notifyRendererOfCrash(): void {
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.webContents.send('server:crash', {
        port: this.port,
      });
    }
  }
}
