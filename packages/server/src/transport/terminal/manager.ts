import { existsSync, statSync } from 'fs';
import type { ServerWebSocket } from 'bun';

type TerminalSocket = ServerWebSocket<unknown>;
import type { IPty, IExitEvent } from 'bun-pty';
import { spawn } from 'bun-pty';
import { encodeFrame, OPCODES } from './frames';
import {
  createTerminalSession,
  markTerminalSessionExited,
  markTerminalSessionDestroyed,
} from '@/store/terminal-sessions';
import type { TerminalSessionInfo } from '@jean2/sdk';
import type { TerminalEventManager } from './event-manager';

interface OutputChunk {
  data: Uint8Array;
  timestamp: number;
}

type TerminalReconnectResult = 'connected' | 'not_found' | 'workspace_mismatch';

interface TerminalSession {
  id: string;
  pty: IPty;
  cwd: string;
  shell: string;
  title: string;
  workspaceId: string;
  clients: Set<TerminalSocket>;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivityAt: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  buffer: OutputChunk[];
  bufferBytes: number;
  inAlternateScreen: boolean;
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  private wsToSessionId = new WeakMap<TerminalSocket, string>();
  private _eventManager: TerminalEventManager | null = null;
  private _getEventManager: (() => TerminalEventManager) | null = null;

  private readonly maxSessionsPerWorkspace: number;
  private readonly maxBufferBytes: number;

  constructor() {
    this.maxSessionsPerWorkspace = parseInt(process.env.JEAN2_TERMINAL_MAX_SESSIONS || '10', 10);
    this.maxBufferBytes = parseInt(process.env.JEAN2_TERMINAL_BUFFER_BYTES || String(5 * 1024 * 1024), 10);
    this.startExitedSessionCleanup();
  }

  setEventManagerGetter(getter: () => TerminalEventManager): void {
    this._getEventManager = getter;
  }

  private get eventManager(): TerminalEventManager {
    if (!this._eventManager) {
      if (!this._getEventManager) {
        throw new Error('TerminalManager: event manager getter not set');
      }
      this._eventManager = this._getEventManager();
    }
    return this._eventManager;
  }

  createSession(
    ws: TerminalSocket,
    options: {
      shell?: string;
      cwd: string;
      workspaceId: string;
      cols?: number;
      rows?: number;
    }
  ): string {
    const { cwd, workspaceId, cols = 80, rows = 24 } = options;
    const shell = options.shell || getDefaultShell();

    if (!cwd || !existsSync(cwd)) {
      const errorPayload = new TextEncoder().encode(JSON.stringify({ message: 'Invalid or missing working directory' }));
      ws.send(encodeFrame(OPCODES.ERROR, errorPayload));
      ws.close();
      return '';
    }

    const stat = statSync(cwd);
    if (!stat.isDirectory()) {
      const errorPayload = new TextEncoder().encode(JSON.stringify({ message: 'Path is not a directory' }));
      ws.send(encodeFrame(OPCODES.ERROR, errorPayload));
      ws.close();
      return '';
    }

    const count = this.getActiveSessionCount(cwd);
    if (count >= this.maxSessionsPerWorkspace) {
      const errorPayload = new TextEncoder().encode(JSON.stringify({
        message: 'Maximum terminal sessions reached for this workspace',
      }));
      ws.send(encodeFrame(OPCODES.ERROR, errorPayload));
      ws.close();
      return '';
    }

    const result = this.spawnSession({ shell, cwd, workspaceId, cols, rows, initialClient: ws });
    if (!result) {
      const errorPayload = new TextEncoder().encode(JSON.stringify({ message: 'Failed to create terminal session' }));
      ws.send(encodeFrame(OPCODES.ERROR, errorPayload));
      ws.close();
      return '';
    }

    return result.sessionId;
  }

  createSessionDetached(options: {
    shell?: string;
    cwd: string;
    workspaceId: string;
    cols?: number;
    rows?: number;
  }): string | null {
    const { cwd } = options;
    if (!cwd || !existsSync(cwd)) return null;
    const stat = statSync(cwd);
    if (!stat.isDirectory()) return null;
    const result = this.spawnSession(options);
    return result?.sessionId ?? null;
  }

  private spawnSession(
    options: {
      shell?: string;
      cwd: string;
      workspaceId: string;
      cols?: number;
      rows?: number;
      initialClient?: TerminalSocket;
    }
  ): { sessionId: string; session: TerminalSession } | null {
    const { cwd, workspaceId, cols = 80, rows = 24, initialClient } = options;
    const shell = options.shell || getDefaultShell();

    if (!cwd || !existsSync(cwd)) return null;

    const stat = statSync(cwd);
    if (!stat.isDirectory()) return null;

    const count = this.getActiveSessionCount(cwd);
    if (count >= this.maxSessionsPerWorkspace) return null;

    const sessionId = crypto.randomUUID();
    const now = Date.now();

    try {
      const pty = spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });

      pty.onData((data: string) => {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'running') return;

        session.lastActivityAt = Date.now();

        if (data.includes('\x1b[?1049h') || data.includes('\x1b[?47h')) {
          session.inAlternateScreen = true;
          this.eventManager.broadcastSessionInfo(workspaceId, this.getSessionInfo(session), 'status_changed');
        }
        if (data.includes('\x1b[?1049l') || data.includes('\x1b[?47l')) {
          session.inAlternateScreen = false;
          this.eventManager.broadcastSessionInfo(workspaceId, this.getSessionInfo(session), 'status_changed');
        }

        const payload = new TextEncoder().encode(data);
        this.bufferOutput(session, payload);

        if (session.clients.size > 0) {
          const frame = encodeFrame(OPCODES.OUTPUT, payload);
          const deadClients: TerminalSocket[] = [];
          for (const client of session.clients) {
            try {
              client.send(frame);
            } catch {
              deadClients.push(client);
            }
          }
          for (const dead of deadClients) {
            session.clients.delete(dead);
            this.wsToSessionId.delete(dead);
          }
        }
      });

      const session: TerminalSession = {
        id: sessionId,
        pty,
        cwd,
        shell,
        title: 'main',
        workspaceId,
        clients: initialClient ? new Set([initialClient]) : new Set(),
        cols,
        rows,
        createdAt: now,
        lastActivityAt: now,
        status: 'running',
        exitCode: null,
        buffer: [],
        bufferBytes: 0,
        inAlternateScreen: false,
      };

      this.sessions.set(sessionId, session);
      if (initialClient) {
        this.wsToSessionId.set(initialClient, sessionId);
      }
      this.eventManager.broadcastSessionInfo(workspaceId, this.getSessionInfo(session), 'created');

      createTerminalSession({
        id: sessionId,
        workspaceId,
        cwd,
        shell,
        pid: pty.pid,
        cols,
        rows,
      });

      pty.onExit((event: IExitEvent) => {
        const s = this.sessions.get(sessionId);
        if (s) {
          s.status = 'exited';
          s.exitCode = event.exitCode;
          markTerminalSessionExited(sessionId, event.exitCode);
          this.eventManager.broadcastSessionInfo(s.workspaceId, this.getSessionInfo(s), 'exited');

          if (s.clients.size > 0) {
            const payload = new TextEncoder().encode(JSON.stringify({ exitCode: event.exitCode }));
            const frame = encodeFrame(OPCODES.EXIT, payload);
            for (const client of s.clients) {
              try {
                client.send(frame);
              } catch {
                // WS might be closed
              }
            }
          }
        }
      });

      return { sessionId, session };
    } catch (err: unknown) {
      console.error('[TerminalManager] spawnSession failed:', err);
      return null;
    }
  }

  reconnectSession(
    ws: TerminalSocket,
    sessionId: string,
    workspaceId: string
  ): TerminalReconnectResult {
    const session = this.sessions.get(sessionId);
    if (!session) return 'not_found';
    if (session.workspaceId !== workspaceId) return 'workspace_mismatch';

    this.wsToSessionId.set(ws, sessionId);
    session.clients.add(ws);

    return 'connected';
  }

  replaySession(ws: TerminalSocket): void {
    const sessionId = this.wsToSessionId.get(ws);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.flushBuffer(session, ws);

    try {
      ws.send(encodeFrame(OPCODES.REPLAY_COMPLETE, new Uint8Array()));
    } catch {
      // WS might be closed
    }

    if (session.status === 'exited' && session.exitCode !== null) {
      const payload = new TextEncoder().encode(JSON.stringify({ exitCode: session.exitCode }));
      try {
        ws.send(encodeFrame(OPCODES.EXIT, payload));
      } catch {
        // WS might be closed
      }
    }
  }

  addClient(ws: TerminalSocket, sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.wsToSessionId.set(ws, sessionId);
    session.clients.add(ws);
    return true;
  }

  removeClient(ws: TerminalSocket): void {
    const sessionId = this.wsToSessionId.get(ws);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.clients.delete(ws);
    this.wsToSessionId.delete(ws);
  }

  handleInput(ws: TerminalSocket, data: string): void {
    const sessionId = this.wsToSessionId.get(ws);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    try {
      session.pty.write(data);
    } catch {
      // PTY might be closed
    }
  }

  handleResize(ws: TerminalSocket, cols: number, rows: number): void {
    const sessionId = this.wsToSessionId.get(ws);
    if (!sessionId) return;
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'running') return;
    try {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    } catch {
      // PTY might be closed
    }
  }

  setTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.title = title;
    this.eventManager.broadcastSessionInfo(session.workspaceId, this.getSessionInfo(session), 'title_changed');
    const payload = new TextEncoder().encode(JSON.stringify({ title }));
    const frame = encodeFrame(OPCODES.TITLE, payload);
    for (const client of session.clients) {
      try {
        client.send(frame);
      } catch {
        // WS might already be closed
      }
    }
  }

  destroySession(ws: TerminalSocket): void {
    const sessionId = this.wsToSessionId.get(ws);
    if (!sessionId) return;
    this.destroySessionById(sessionId);
  }

  destroySessionById(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.eventManager.broadcastDestroyed(session.workspaceId, sessionId);

    try {
      session.pty.kill();
    } catch {
      // Process might already be dead
    }

    for (const client of session.clients) {
      this.wsToSessionId.delete(client);
      try {
        client.close();
      } catch {
        // WS might already be closed
      }
    }

    session.clients.clear();
    this.sessions.delete(sessionId);
    markTerminalSessionDestroyed(sessionId);
  }

  destroyAllSessions(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.destroySessionById(sessionId);
    }
  }

  destroySessionsForWorkspace(workspacePath: string): void {
    const ids = [...this.sessions.entries()]
      .filter(([, s]) => s.cwd === workspacePath)
      .map(([id]) => id);
    for (const id of ids) {
      this.destroySessionById(id);
    }
  }

  getSession(sessionId: string): TerminalSessionInfo | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.getSessionInfo(session);
  }

  private getSessionInfo(session: TerminalSession): TerminalSessionInfo {
    return {
      id: session.id,
      pid: session.pty.pid,
      shell: session.shell,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      title: session.title,
      status: session.status,
      exitCode: session.exitCode,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      activeClientCount: session.clients.size,
      inAlternateScreen: session.inAlternateScreen,
    };
  }

  listSessionsForWorkspace(workspacePath: string): TerminalSessionInfo[] {
    const result: TerminalSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.cwd === workspacePath) {
        result.push({
          id: session.id,
          pid: session.pty.pid,
          shell: session.shell,
          cwd: session.cwd,
          cols: session.cols,
          rows: session.rows,
          title: session.title,
          status: session.status,
          exitCode: session.exitCode,
          createdAt: session.createdAt,
          lastActivityAt: session.lastActivityAt,
          activeClientCount: session.clients.size,
          inAlternateScreen: session.inAlternateScreen,
        });
      }
    }
    return result;
  }

  listSessionsByWorkspaceId(workspaceId: string): TerminalSessionInfo[] {
    const result: TerminalSessionInfo[] = [];
    for (const session of this.sessions.values()) {
      if (session.workspaceId === workspaceId) {
        result.push(this.getSessionInfo(session));
      }
    }
    return result;
  }

  getActiveSessionCount(workspacePath: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.cwd === workspacePath && session.status === 'running') {
        count++;
      }
    }
    return count;
  }

  getActiveClientCount(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    return session?.clients.size ?? 0;
  }

  private bufferOutput(session: TerminalSession, data: Uint8Array): void {
    const now = Date.now();

    if (data.length > this.maxBufferBytes) {
      session.buffer = [{ data, timestamp: now }];
      session.bufferBytes = data.length;
      return;
    }

    while (
      session.buffer.length > 0 &&
      session.bufferBytes + data.length > this.maxBufferBytes
    ) {
      const removed = session.buffer.shift()!;
      session.bufferBytes -= removed.data.length;
    }

    session.buffer.push({ data, timestamp: now });
    session.bufferBytes += data.length;
  }

  private flushBuffer(session: TerminalSession, ws: TerminalSocket): void {
    if (session.buffer.length > 0) {
      console.log(`[TerminalManager] flushBuffer sessionId=${session.id} chunks=${session.buffer.length} bytes=${session.bufferBytes}`);
    }
    for (const chunk of session.buffer) {
      try {
        ws.send(encodeFrame(OPCODES.OUTPUT, chunk.data));
      } catch {
        break;
      }
    }
  }

  private startExitedSessionCleanup(): void {
    const EXPIRED_MS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (
          session.status === 'exited' &&
          session.clients.size === 0 &&
          now - session.lastActivityAt > EXPIRED_MS
        ) {
          this.destroySessionById(id);
        }
      }
    }, 5 * 60 * 1000);
  }
}
