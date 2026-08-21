import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { ProkopaiClient, TerminalConnection } from '@prokopai/sdk';

export type TerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'exited';

export interface SessionInitData {
  sessionId: string;
  pid: number;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  status: 'running' | 'exited';
  exitCode: number | null;
  isReconnect: boolean;
  title: string;
  createdAt: number;
  inAlternateScreen?: boolean;
}

export interface CachedTerminal {
  terminal: Terminal;
  fitAddon: FitAddon;
  serverSessionId: string;
  status: TerminalStatus;
  isOpened: boolean;
}

export interface TerminalCache {
  get(id: string): CachedTerminal | undefined;
  set(id: string, cached: CachedTerminal): void;
  delete(id: string): void;
  has(id: string): boolean;
  clear(): void;
  dispose(id: string): void;
  disposeAll(): void;
}

export function createTerminalCache(): TerminalCache {
  const cache = new Map<string, CachedTerminal>();

  return {
    get(id) { return cache.get(id); },
    set(id, cached) { cache.set(id, cached); },
    delete(id) { cache.delete(id); },
    has(id) { return cache.has(id); },
    clear() { cache.clear(); },
    dispose(id) {
      const entry = cache.get(id);
      if (entry) {
        entry.terminal.dispose();
        cache.delete(id);
      }
    },
    disposeAll() {
      for (const entry of cache.values()) {
        entry.terminal.dispose();
      }
      cache.clear();
    },
  };
}

export interface CreateTerminalOptions {
  scrollback?: number;
  fontSize?: number;
  theme?: {
    background: string;
    foreground: string;
    cursor: string;
    selectionBackground: string;
  };
}

export function createTerminalInstance(options?: CreateTerminalOptions): { terminal: Terminal; fitAddon: FitAddon } {
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: options?.fontSize ?? 13,
    fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
    scrollback: options?.scrollback ?? 1000,
    allowProposedApi: true,
    theme: options?.theme ?? {
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      cursor: 'var(--foreground)',
      selectionBackground: 'var(--accent)',
    },
  });

  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);

  return { terminal, fitAddon };
}

function showTerminalElement(terminal: Terminal | null): void {
  const element = terminal?.element;
  if (element) {
    element.style.visibility = '';
  }
}

export interface UseTerminalConnectionOptions {
  terminal: Terminal | null;
  sdkClient: ProkopaiClient;
  workspaceId: string;
  cwd: string;
  serverSessionId?: string | null;
  onOutput: (data: string) => void;
  onStatusChange: (status: TerminalStatus) => void;
  onExit?: (exitCode: number) => void;
  onSessionInit?: (init: SessionInitData) => void;
  onTitleChange?: (title: string) => void;
}

export function useTerminalConnection(
  terminal: Terminal | null,
  options: UseTerminalConnectionOptions
): {
  connect: (sessionId: string | null | undefined) => void;
  disconnect: () => void;
  destroy: () => void;
} {
  const { sdkClient, workspaceId, cwd } = options;
  const connectionRef = useRef<TerminalConnection | null>(null);
  const statusRef = useRef<TerminalStatus>('disconnected');
  const disposedRef = useRef(false);
  const connectionGenerationRef = useRef(0);

  const onOutputRef = useRef(options.onOutput);
  const onStatusChangeRef = useRef(options.onStatusChange);
  const onExitRef = useRef(options.onExit);
  const onSessionInitRef = useRef(options.onSessionInit);
  const onTitleChangeRef = useRef(options.onTitleChange);

  const sdkClientRef = useRef(sdkClient);
  const workspaceIdRef = useRef(workspaceId);
  const cwdRef = useRef(cwd);
  const serverSessionIdRef = useRef(options.serverSessionId);
  const terminalRef = useRef(options.terminal);

  useEffect(() => {
    onOutputRef.current = options.onOutput;
    onStatusChangeRef.current = options.onStatusChange;
    onExitRef.current = options.onExit;
    onSessionInitRef.current = options.onSessionInit;
    onTitleChangeRef.current = options.onTitleChange;
  });

  useEffect(() => {
    sdkClientRef.current = sdkClient;
    workspaceIdRef.current = workspaceId;
    cwdRef.current = cwd;
    serverSessionIdRef.current = options.serverSessionId;
    terminalRef.current = options.terminal;
  }, [sdkClient, workspaceId, cwd, options.serverSessionId, options.terminal]);

  const setStatus = useCallback((status: TerminalStatus) => {
    statusRef.current = status;
    onStatusChangeRef.current?.(status);
  }, []);

  const connect = useCallback(async (sessionId: string | null | undefined) => {
    const generation = ++connectionGenerationRef.current;

    // Close existing connection
    const existingConn = connectionRef.current;
    if (existingConn) {
      existingConn.removeAllListeners();
      existingConn.dispose();
      connectionRef.current = null;
    }

    showTerminalElement(terminalRef.current);

    setStatus('connecting');

    try {
      const connection = await sdkClientRef.current.terminal.connect({
        workspaceId: workspaceIdRef.current,
        cwd: cwdRef.current,
        sessionId: sessionId ?? undefined,
      });

      if (connectionGenerationRef.current !== generation) {
        connection.dispose();
        return;
      }

      connectionRef.current = connection;

      let isRestoringReplay = connection.isReconnect;
      let replayFallback: ReturnType<typeof setTimeout> | null = null;
      const replayOutput: string[] = [];
      const reconnectNotice = connection.isReconnect && connection.session.inAlternateScreen
        ? '\r\n\x1b[33m[Reconnected — a full-screen application is running. Press Ctrl+C to exit it.]\x1b[0m\r\n'
        : '';

      const finishReplay = () => {
        if (!isRestoringReplay) return;
        isRestoringReplay = false;
        if (replayFallback) {
          clearTimeout(replayFallback);
          replayFallback = null;
        }
        if (connectionGenerationRef.current !== generation) return;

        const replay = replayOutput.join('') + reconnectNotice;
        const replayTerminal = terminalRef.current;
        if (!replayTerminal) {
          onOutputRef.current?.(replay);
          return;
        }

        const element = replayTerminal.element;
        if (element) {
          element.style.visibility = 'hidden';
        }
        replayTerminal.reset();

        let revealFallback: ReturnType<typeof setTimeout> | null = null;
        const reveal = () => {
          if (revealFallback) {
            clearTimeout(revealFallback);
            revealFallback = null;
          }
          if (connectionGenerationRef.current === generation && element) {
            element.style.visibility = '';
          }
        };

        if (replay.length === 0) {
          reveal();
          return;
        }
        replayTerminal.write(replay, reveal);
        revealFallback = setTimeout(reveal, 5000);
      };

      connection.on('output', (data: Uint8Array) => {
        if (connectionGenerationRef.current !== generation) return;
        const decoded = new TextDecoder().decode(data);
        if (isRestoringReplay) {
          replayOutput.push(decoded);
          return;
        }
        onOutputRef.current?.(decoded);
      });

      if (isRestoringReplay) {
        replayFallback = setTimeout(finishReplay, 5000);
      }
      connection.on('replay_complete', finishReplay);

      connection.on('exit', (exitCode: number) => {
        if (connectionGenerationRef.current !== generation) return;
        setStatus('exited');
        onExitRef.current?.(exitCode);
      });

      connection.on('title', (title: string) => {
        if (connectionGenerationRef.current !== generation) return;
        onTitleChangeRef.current?.(title);
      });

      connection.on('close', () => {
        if (connectionGenerationRef.current !== generation) return;
        connectionRef.current = null;
        if (statusRef.current !== 'exited') {
          setStatus('disconnected');
        }
      });

      connection.on('error', (error: Error) => {
        if (connectionGenerationRef.current !== generation) return;
        console.error('[useTerminal]', error.message);
        setStatus('disconnected');
      });

      // Handle reconnect special cases (formerly INIT_ACK logic)
      if (connection.isReconnect && connection.status === 'exited') {
        setStatus('exited');
        onExitRef.current?.(connection.exitCode ?? 0);
      } else if (connection.isReconnect && connection.session.inAlternateScreen) {
        setStatus('connected');
      } else {
        setStatus('connected');
      }

      // Call onSessionInit with session data
      const session = connection.session;
      onSessionInitRef.current?.({
        sessionId: session.sessionId,
        pid: session.pid,
        shell: session.shell,
        cwd: session.cwd,
        cols: session.cols,
        rows: session.rows,
        status: session.status,
        exitCode: session.exitCode,
        isReconnect: session.isReconnect,
        title: session.title,
        createdAt: session.createdAt,
        inAlternateScreen: session.inAlternateScreen,
      });
    } catch (err: unknown) {
      if (connectionGenerationRef.current !== generation) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error('[useTerminal] Connection failed:', message);
      setStatus('disconnected');
    }
  }, [setStatus]);

  useEffect(() => {
    if (!terminal) return;
    disposedRef.current = false;

    const onDataDisposable = terminal.onData((data: string) => {
      const connection = connectionRef.current;
      if (!connection || connection.closed) return;
      connection.write(data);
    });

    const onResizeDisposable = terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      const connection = connectionRef.current;
      if (!connection || connection.closed) return;
      connection.resize(cols, rows);
    });

    return () => {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      disposedRef.current = true;
      const connection = connectionRef.current;
      if (connection) {
        connection.removeAllListeners();
        connection.dispose();
        connectionRef.current = null;
      }
    };
  }, [terminal]);

  const disconnect = useCallback(() => {
    const connection = connectionRef.current;
    if (connection) {
      connection.removeAllListeners();
      connection.dispose();
      connectionRef.current = null;
    }
  }, []);

  const destroy = useCallback(() => {
    const connection = connectionRef.current;
    if (connection) {
      connection.removeAllListeners();
      connection.close();
      connectionRef.current = null;
    }
    disposedRef.current = true;
  }, []);

  return { connect, disconnect, destroy };
}
