import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import { X, Plus, Terminal as TerminalIcon, ChevronUp, ChevronDown } from 'lucide-react';
import { TerminalView } from './TerminalView';
import {
  useTerminalConnection,
  createTerminalInstance,
  createTerminalCache,
  type CachedTerminal,
  type TerminalStatus,
  type SessionInitData,
  type TerminalCache,
} from '@/hooks/useTerminal';
import type { TerminalEvent } from '@prokopai/sdk';
import type { TerminalEventsConnection } from '@prokopai/sdk';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ProkopaiClient } from '@prokopai/sdk';
import { cn } from '@/lib/utils';

export interface TerminalPanelHandle {
  focus: () => void;
}

interface TerminalTab {
  serverSessionId: string;
  title: string;
  status: TerminalStatus;
  cwd: string;
  shell: string;
}

interface TerminalPanelProps {
  workspaceId: string | undefined;
  workspacePath: string | undefined;
  workspaceName: string | undefined;
  sdkClient: ProkopaiClient | null;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const DEFAULT_HEIGHT = 300;
const MIN_HEIGHT = 200;
const MAX_HEIGHT_RATIO = 0.7;

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({
  workspaceId,
  workspacePath,
  workspaceName,
  sdkClient,
  isOpen,
  onOpen,
  onClose,
}, ref) {
  const isMobile = useIsMobile();
  const viewport = useVisualViewport();

  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabServerId, setActiveTabServerId] = useState<string | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const [connectionTarget, setConnectionTarget] = useState<CachedTerminal | null>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const reconnectAttemptRef = useRef(0);

  const terminalCacheRef = useRef<TerminalCache>(createTerminalCache());
  const activeConnectionRef = useRef<{
    serverSessionId: string;
    disconnect: () => void;
    destroy: () => void;
  } | null>(null);
  const eventsConnRef = useRef<TerminalEventsConnection | null>(null);
  const tabsRef = useRef<TerminalTab[]>([]);
  const handleTerminalEventRef = useRef<(event: TerminalEvent) => void>(() => {});
  const autoCreateRef = useRef(false);
  const autoCreateResetRef = useRef<string | undefined>(undefined);
  const activeTabByWorkspaceRef = useRef<Map<string, string>>(new Map());
  const addTabRef = useRef<() => void>(() => {});

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const handleTerminalEvent = useCallback((event: TerminalEvent) => {
    switch (event.type) {
      case 'snapshot': {
        setTabs(prev => event.sessions.map(s => {
          const existing = prev.find(tab => tab.serverSessionId === s.id);
          return {
            serverSessionId: s.id,
            title: s.title,
            status: s.status === 'exited' ? 'exited' : existing?.status ?? 'disconnected',
            cwd: s.cwd,
            shell: s.shell,
          };
        }));

        if (event.sessions.length > 0) {
          const rememberedId = workspaceId
            ? activeTabByWorkspaceRef.current.get(workspaceId)
            : undefined;
          setActiveTabServerId(prev => {
            let selectedId = event.sessions[0].id;
            if (rememberedId && event.sessions.some(s => s.id === rememberedId)) {
              selectedId = rememberedId;
            } else if (prev && event.sessions.some(s => s.id === prev)) {
              selectedId = prev;
            }
            if (workspaceId) {
              activeTabByWorkspaceRef.current.set(workspaceId, selectedId);
            }
            return selectedId;
          });
        } else {
          if (workspaceId) {
            activeTabByWorkspaceRef.current.delete(workspaceId);
          }
          setActiveTabServerId(null);
          if (!autoCreateRef.current) {
            autoCreateRef.current = true;
            addTabRef.current();
          }
        }

        break;
      }
      case 'created': {
        setTabs(prev => {
          if (prev.some(t => t.serverSessionId === event.session.id)) {
            return prev;
          }
          return [...prev, {
            serverSessionId: event.session.id,
            title: event.session.title,
            status: 'disconnected',
            cwd: event.session.cwd,
            shell: event.session.shell,
          }];
        });
        if (workspaceId) {
          activeTabByWorkspaceRef.current.set(workspaceId, event.session.id);
        }
        setActiveTabServerId(event.session.id);
        break;
      }
      case 'destroyed': {
        setTabs(prev => prev.filter(t => t.serverSessionId !== event.sessionId));
        terminalCacheRef.current.dispose(event.sessionId);
        setActiveTabServerId(prev => {
          if (prev !== event.sessionId) return prev;
          const remaining = tabsRef.current.filter(t => t.serverSessionId !== event.sessionId);
          const nextId = remaining.length > 0 ? remaining[0].serverSessionId : null;
          if (workspaceId) {
            if (nextId) {
              activeTabByWorkspaceRef.current.set(workspaceId, nextId);
            } else {
              activeTabByWorkspaceRef.current.delete(workspaceId);
            }
          }
          return nextId;
        });
        break;
      }
      case 'exited': {
        setTabs(prev => prev.map(t =>
          t.serverSessionId === event.sessionId
            ? { ...t, status: 'exited' }
            : t
        ));
        break;
      }
      case 'title_changed': {
        setTabs(prev => prev.map(t =>
          t.serverSessionId === event.sessionId
            ? { ...t, title: event.title }
            : t
        ));
        break;
      }
      case 'status_changed': {
        if (event.status === 'exited') {
          setTabs(prev => prev.map(t =>
            t.serverSessionId === event.sessionId
              ? { ...t, status: 'exited' }
              : t
          ));
        }
        break;
      }
    }
  }, [workspaceId]);

  useEffect(() => {
    handleTerminalEventRef.current = handleTerminalEvent;
  }, [handleTerminalEvent]);

  useEffect(() => {
    if (!workspaceId || !isOpen || !sdkClient) {
      setTabs([]);
      setActiveTabServerId(null);
      autoCreateRef.current = false;

      if (activeConnectionRef.current) {
        activeConnectionRef.current.disconnect();
        activeConnectionRef.current = null;
      }
      setConnectionTarget(null);
      terminalCacheRef.current.disposeAll();

      if (eventsConnRef.current) {
        eventsConnRef.current.dispose();
        eventsConnRef.current = null;
      }
      return;
    }

    const terminalClient = sdkClient;
    const terminalWorkspaceId = workspaceId;
    let cancelled = false;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let currentConn: TerminalEventsConnection | null = null;
    if (activeConnectionRef.current) {
      activeConnectionRef.current.disconnect();
      activeConnectionRef.current = null;
    }
    setConnectionTarget(null);
    terminalCacheRef.current.disposeAll();

    const scheduleRetry = (error: Error) => {
      if (cancelled || retryTimer) return;
      console.error('[TerminalPanel] Terminal events connection failed:', error.message);

      const delay = Math.min(1000 * 2 ** retryAttempt, 10000);
      retryAttempt++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        subscribe();
      }, delay);

      const conn = currentConn;
      currentConn = null;
      if (eventsConnRef.current === conn) {
        eventsConnRef.current = null;
      }
      conn?.dispose();
    };

    function subscribe() {
      terminalClient.terminal.subscribeEvents(terminalWorkspaceId).then(({ conn, initialSessions }) => {
        if (cancelled) {
          conn.dispose();
          return;
        }

        retryAttempt = 0;
        currentConn = conn;
        eventsConnRef.current = conn;
        handleTerminalEventRef.current({ type: 'snapshot', sessions: initialSessions });

        conn.on('snapshot', (sessions) => {
          handleTerminalEventRef.current({ type: 'snapshot', sessions });
        });
        conn.on('created', (session) => {
          handleTerminalEventRef.current({ type: 'created', session });
        });
        conn.on('destroyed', (sessionId) => {
          handleTerminalEventRef.current({ type: 'destroyed', sessionId });
        });
        conn.on('exited', (sessionId, exitCode) => {
          handleTerminalEventRef.current({ type: 'exited', sessionId, exitCode });
        });
        conn.on('title_changed', (sessionId, title) => {
          handleTerminalEventRef.current({ type: 'title_changed', sessionId, title });
        });
        conn.on('status_changed', (sessionId, status) => {
          handleTerminalEventRef.current({ type: 'status_changed', sessionId, status });
        });
        conn.on('close', () => {
          scheduleRetry(new Error('Terminal events connection closed'));
        });
        conn.on('error', (error) => {
          scheduleRetry(error);
        });
      }).catch((err: unknown) => {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        scheduleRetry(error);
      });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      currentConn?.dispose();
      currentConn = null;
      eventsConnRef.current = null;
    };
  }, [workspaceId, isOpen, sdkClient]);

  const onOutput = useCallback((serverSessionId: string) => (data: string) => {
    const cached = terminalCacheRef.current.get(serverSessionId);
    cached?.terminal.write(data);
  }, []);

  const onStatusChange = useCallback((serverSessionId: string) => (status: TerminalStatus) => {
    if (status === 'connected') {
      reconnectAttemptRef.current = 0;
    }
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, status }
        : t
    ));
  }, []);

  const onSessionInit = useCallback((serverSessionId: string) => (init: SessionInitData) => {
    const cached = terminalCacheRef.current.get(serverSessionId);
    if (cached) {
      cached.serverSessionId = init.sessionId;
    }
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, title: init.title || t.title }
        : t
    ));
  }, []);

  const onTitleChange = useCallback((serverSessionId: string) => (title: string) => {
    setTabs(prev => prev.map(t =>
      t.serverSessionId === serverSessionId
        ? { ...t, title }
        : t
    ));
  }, []);

  const { connect, disconnect, destroy } = useTerminalConnection(
    connectionTarget?.terminal ?? null,
    connectionTarget && sdkClient && workspaceId && workspacePath && connectionTarget.serverSessionId ? {
      terminal: connectionTarget.terminal,
      sdkClient,
      workspaceId,
      cwd: tabs.find(t => t.serverSessionId === connectionTarget.serverSessionId)?.cwd ?? workspacePath,
      serverSessionId: connectionTarget.serverSessionId,
      onOutput: onOutput(connectionTarget.serverSessionId),
      onStatusChange: onStatusChange(connectionTarget.serverSessionId),
      onSessionInit: onSessionInit(connectionTarget.serverSessionId),
      onTitleChange: onTitleChange(connectionTarget.serverSessionId),
    } : {
      terminal: null,
      sdkClient: null as unknown as import('@prokopai/sdk').ProkopaiClient,
      workspaceId: '',
      cwd: '',
      onOutput: () => {},
      onStatusChange: () => {},
    }
  );

  const attachActiveTerminal = useCallback(() => {
    if (!activeTabServerId || !sdkClient || !workspacePath) return;

    const cached = terminalCacheRef.current.get(activeTabServerId);

    let terminalEntry: CachedTerminal;
    if (cached) {
      terminalEntry = cached;
    } else {
      const { terminal, fitAddon } = createTerminalInstance();
      terminalEntry = {
        terminal,
        fitAddon,
        serverSessionId: activeTabServerId,
        status: 'connecting',
        isOpened: false,
      };
      terminalCacheRef.current.set(activeTabServerId, terminalEntry);
    }

    if (activeConnectionRef.current) {
      activeConnectionRef.current.disconnect();
      activeConnectionRef.current = null;
    }

    setConnectionTarget(terminalEntry);
  }, [activeTabServerId, sdkClient, workspacePath]);

  useEffect(() => {
    if (!isOpen || !activeTabServerId) return;
    attachActiveTerminal();
  }, [isOpen, activeTabServerId, attachActiveTerminal]);

  useEffect(() => {
    if (connectionTarget && connectionTarget.serverSessionId) {
      activeConnectionRef.current = {
        serverSessionId: connectionTarget.serverSessionId,
        disconnect,
        destroy,
      };
      connect(connectionTarget.serverSessionId);
    }
  }, [connectionTarget, connect, disconnect, destroy]);

  const activeTabStatus = tabs.find(t => t.serverSessionId === activeTabServerId)?.status;

  useEffect(() => {
    reconnectAttemptRef.current = 0;
  }, [workspaceId, activeTabServerId]);

  useEffect(() => {
    if (
      !isOpen ||
      !activeTabServerId ||
      activeTabStatus !== 'disconnected' ||
      reconnectAttemptRef.current >= 5
    ) return;

    const delay = Math.min(1000 * 2 ** reconnectAttemptRef.current, 10000);
    reconnectAttemptRef.current++;
    const retryTimer = setTimeout(() => {
      connect(activeTabServerId);
    }, delay);

    return () => clearTimeout(retryTimer);
  }, [workspaceId, isOpen, activeTabServerId, activeTabStatus, connect]);

  const selectTerminalTab = useCallback((serverSessionId: string) => {
    if (workspaceId) {
      activeTabByWorkspaceRef.current.set(workspaceId, serverSessionId);
    }
    if (serverSessionId === activeTabServerId && activeTabStatus === 'disconnected') {
      reconnectAttemptRef.current = 0;
      connect(serverSessionId);
      return;
    }
    setActiveTabServerId(serverSessionId);
  }, [workspaceId, activeTabServerId, activeTabStatus, connect]);

  const addTab = useCallback(async () => {
    if (!workspaceId || !workspacePath || !sdkClient) return;

    try {
      await sdkClient.http.terminals.create(workspaceId, { body: { cwd: workspacePath } });
    } catch (err) {
      console.error('[TerminalPanel] Failed to create terminal:', err);
    }
  }, [workspaceId, workspacePath, sdkClient]);

  useEffect(() => {
    addTabRef.current = addTab;
  }, [addTab]);

  const closeTab = useCallback(async (serverSessionId: string) => {
    if (!workspaceId || !sdkClient) return;

    if (activeConnectionRef.current?.serverSessionId === serverSessionId) {
      activeConnectionRef.current.destroy();
      activeConnectionRef.current = null;
      setConnectionTarget(null);
    }

    terminalCacheRef.current.dispose(serverSessionId);

    try {
      await sdkClient.http.terminals.delete(workspaceId, serverSessionId);
    } catch (err) {
      console.error('[TerminalPanel] Failed to destroy terminal:', err);
    }
  }, [workspaceId, sdkClient]);

  useEffect(() => {
    if (autoCreateResetRef.current !== workspaceId) {
      autoCreateResetRef.current = workspaceId;
      autoCreateRef.current = false;
    }
  }, [workspaceId]);

  useEffect(() => {
    return () => {
      const cache = terminalCacheRef.current;
      cache.disposeAll();
    };
  }, []);

  const focusActiveTerminal = useCallback(() => {
    if (activeTabServerId) {
      const cached = terminalCacheRef.current.get(activeTabServerId);
      cached?.terminal.focus();
    }
  }, [activeTabServerId]);

  useImperativeHandle(ref, () => ({
    focus: focusActiveTerminal,
  }), [focusActiveTerminal]);

  useEffect(() => {
    if (!isOpen || !activeTabServerId) return;
    const timer = setTimeout(focusActiveTerminal, 300);
    return () => clearTimeout(timer);
  }, [isOpen, activeTabServerId, focusActiveTerminal]);

  const handleResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    startYRef.current = clientY;
    startHeightRef.current = panelHeight;

    const handleMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      const clientY = 'touches' in ev ? ev.touches[0].clientY : (ev as MouseEvent).clientY;
      const delta = startYRef.current - clientY;
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO;
      const newHeight = Math.min(Math.max(startHeightRef.current + delta, MIN_HEIGHT), maxH);
      setPanelHeight(newHeight);
    };

    const handleUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleUp);
  }, [panelHeight]);


  if (!workspaceId || !workspacePath || !sdkClient) {
    return (
      <div className="flex items-center justify-center h-[300px] border-t border-border bg-background text-muted-foreground text-sm">
        Select a workspace to use the terminal.
      </div>
    );
  }

  const shortName = workspaceName || workspacePath.split('/').pop() || 'ws';
  const activeTab = tabs.find(t => t.serverSessionId === activeTabServerId);
    
  const activeCached = activeTabServerId ? terminalCacheRef.current.get(activeTabServerId) : null;

  const statusIndicator = (status: TerminalStatus) => {
    switch (status) {
      case 'connecting': return 'bg-warning';
      case 'connected': return 'bg-success';
      case 'disconnected': return 'bg-muted-foreground';
      case 'exited': return 'bg-error';
    }
  };

  const renderTabs = () => (
    <div className="flex items-center gap-0.5 overflow-x-auto px-1 min-h-[32px]">
      {tabs.map(tab => (
        <div
          key={tab.serverSessionId}
          className={cn(
            'group flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer rounded-sm whitespace-nowrap border border-transparent',
            tab.serverSessionId === activeTabServerId
              ? 'bg-accent text-accent-foreground border-border'
              : 'text-muted-foreground hover:bg-muted'
          )}
          onClick={() => selectTerminalTab(tab.serverSessionId)}
        >
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusIndicator(tab.status))} />
          <span>{shortName} {tab.title}</span>
          <button
            className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity ml-0.5"
            onClick={(e) => { e.stopPropagation(); closeTab(tab.serverSessionId); }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={addTab}
        title="New terminal tab"
      >
        <Plus className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  const renderTerminalContent = () => (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      {activeCached && activeTab ? (
        <TerminalView
          key={activeTabServerId}
          cachedTerminal={activeCached}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          No terminal sessions
        </div>
      )}
    </div>
  );

  if (isMobile) {
    const keyboardOpen = viewport.height < window.innerHeight * 0.85;
    const sheetHeight = keyboardOpen
      ? `calc(${viewport.height}px - env(safe-area-inset-top, 0px))`
      : Math.min(window.innerHeight * 0.7, viewport.height);

    return (
      <>
        {/* Single header bar — toggles both directions */}
        <div className="flex items-center gap-2 border-t border-border bg-background px-3 py-1 shrink-0">
          <button
            onClick={() => isOpen ? onClose() : onOpen()}
            className="flex items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <TerminalIcon className="w-3 h-3 flex-shrink-0" />
            <span>Terminal</span>
          </button>
          <div className="flex-1" />
          <button
            onClick={() => isOpen ? onClose() : onOpen()}
            className="text-muted-foreground hover:text-foreground"
          >
            {isOpen
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronUp className="w-3 h-3" />}
          </button>
        </div>
        {isOpen && (
          <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <SheetContent
              side="top"
              className="p-0 bg-background [&>button]:hidden flex flex-col"
              style={{ height: sheetHeight }}
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Terminal</SheetTitle>
              </SheetHeader>
              {renderTabs()}
              {renderTerminalContent()}
            </SheetContent>
          </Sheet>
        )}
      </>
    );
  }

  return (
    <div data-terminal-panel="">
      {/* Single header bar — toggles both directions, tabs inline when expanded */}
      <div className="flex items-center gap-1 border-t border-border bg-background px-2 py-1 shrink-0">
        <TerminalIcon className="w-3 h-3 text-muted-foreground flex-shrink-0" />
        {isOpen ? (
          <div className="flex items-center gap-0.5 overflow-x-auto flex-1 min-h-0">
            {tabs.map(tab => (
              <div
                key={tab.serverSessionId}
                className={cn(
                  'group flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer rounded-sm whitespace-nowrap border border-transparent',
                  tab.serverSessionId === activeTabServerId
                    ? 'bg-accent text-accent-foreground border-border'
                    : 'text-muted-foreground hover:bg-muted'
                )}
                onClick={() => selectTerminalTab(tab.serverSessionId)}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusIndicator(tab.status))} />
                <span>{shortName} {tab.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity ml-0.5"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.serverSessionId); }}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              onClick={addTab}
              title="New terminal tab"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground flex-1">Terminal</span>
        )}
        <button
          onClick={() => isOpen ? onClose() : onOpen()}
          className="flex items-center justify-center size-5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {isOpen
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronUp className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Expanded content */}
      {isOpen && (
        <>
          <div
            className="w-full cursor-ns-resize flex items-center justify-center border-t border-border bg-background select-none shrink-0"
            style={{ height: 4 }}
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
          >
            <div className="w-10 h-0.5 bg-muted-foreground/30 rounded-full" />
          </div>
          <div
            className="flex flex-col border-t border-border bg-background overflow-hidden shrink-0"
            style={{ height: panelHeight }}
          >
            {renderTerminalContent()}
          </div>
        </>
      )}
    </div>
  );
});
