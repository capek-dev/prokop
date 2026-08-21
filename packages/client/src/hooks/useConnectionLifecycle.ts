import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ProkopaiClient, HttpClient } from '@prokopai/sdk';
import type { ClientDescriptor } from '@prokopai/sdk';
import type { SessionHandlersContext } from '@/handlers/serverMessage';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useAskStore } from '@/stores/askStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { toast } from 'sonner';
import { subscribeToServerEvents } from './subscribeToServerEvents';
import { resolveClientDescriptor } from '@/config/client-identity';

const CONNECTION_TIMEOUT = 10000;
const MAX_RETRY_DELAY = 30000;
const INITIAL_RETRY_DELAY = 1000;

export interface ConnectionLifecycleParams {
  apiToken: string | null;
  serverUrl: string | null;
  currentSessionIdRef: RefObject<string | null>;
  handlerContextRef: RefObject<SessionHandlersContext | null>;
  handleLogout: () => void;
  clientRef?: RefObject<ProkopaiClient | null>;
}

export interface ConnectionLifecycleReturn {
  clientRef: RefObject<ProkopaiClient | null>;
  retry: () => void;
}

export function useConnectionLifecycle({
  apiToken,
  serverUrl,
  currentSessionIdRef,
  handlerContextRef,
  handleLogout,
  clientRef: externalClientRef,
}: ConnectionLifecycleParams): ConnectionLifecycleReturn {
  const internalClientRef = useRef<ProkopaiClient | null>(null);
  const clientRef = externalClientRef ?? internalClientRef;
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [clientDescriptor, setClientDescriptor] = useState<ClientDescriptor | null>(null);

  const retry = useCallback(() => {
    useConnectionStore.getState().setRetryCount(0);
    useConnectionStore.getState().setConnectionTimedOut(false);
    useConnectionStore.getState().setNextRetryIn(0);
    useConnectionStore.getState().setAuthError(null);
    setReconnectAttempt(n => n + 1);
  }, []);

  const connected = useConnectionStore((s) => s.connected);
  const connectionTimedOut = useConnectionStore((s) => s.connectionTimedOut);

  useEffect(() => {
    if (!serverUrl) return;
    let cancelled = false;
    resolveClientDescriptor().then((descriptor) => {
      if (!cancelled) {
        setClientDescriptor(descriptor);
        useClientIdentityStore.getState().setClientId(descriptor.clientId);
      }
    });
    return () => { cancelled = true; };
  }, [serverUrl]);

  useEffect(() => {
    if (!serverUrl || !clientDescriptor) {
      return;
    }

    let cancelled = false;

    const createAndConnectClient = () => {
      const client = new ProkopaiClient({
        url: serverUrl,
        ...(apiToken ? { token: apiToken } : {}),
        autoSyncPermissions: false,
        clientDescriptor,
      });

      clientRef.current = client;

      client.on('connected', () => {
        useConnectionStore.getState().setConnected(true);
        useConnectionStore.getState().setAuthError(null);
        useConnectionStore.getState().setRetryCount(0);
        useConnectionStore.getState().setConnectionTimedOut(false);

        // Clear pending ask requests on reconnection (including permission asks)
        useAskStore.getState().clearPendingRequests();

        // Resume all board-visible sessions (multi-session support).
        // Fall back to single-session resume for backward compat if no board state.
        const boardState = useSessionBoardStore.getState();
        const openSessionIds = boardState.openSessionIds;

        if (openSessionIds.length > 0) {
          // Resume all open board sessions
          for (const sid of openSessionIds) {
            const hasContent = !!useSessionStore.getState().messagesBySession[sid]?.length;
            if (!hasContent) {
              useSessionStore.getState().beginSessionContentLoad(sid);
            }
            client.sessions.resume(sid);
          }
          // Ensure currentSessionIdRef is set for backward compat
          const focusedId = boardState.focusedSessionId ?? openSessionIds[0];
          currentSessionIdRef.current = focusedId;
          console.log('[reconnect] Resumed board sessions:', openSessionIds.length);
        } else {
          // Fall back to single-session resume for backward compat
          const sessionId = currentSessionIdRef.current
            ?? useSessionStore.getState().currentSession?.id;

          if (sessionId) {
            const wasNull = currentSessionIdRef.current === null;
            currentSessionIdRef.current = sessionId;
            const hasContent = !!useSessionStore.getState().messagesBySession[sessionId]?.length;
            if (!hasContent) {
              useSessionStore.getState().beginSessionContentLoad(sessionId);
            }
            console.log('[reconnect] Resuming session:', sessionId, wasNull ? '(restored from store)' : '(from ref)');
            client.sessions.resume(sessionId);
          } else {
            console.log('[reconnect] No session to resume (ref:', currentSessionIdRef.current, ', store:', useSessionStore.getState().currentSession?.id, ')');
          }
        }
      });

      client.on('disconnected', (payload) => {
        useConnectionStore.getState().setConnected(false);

        const pendingOps = usePendingOperationsStore.getState().operations;
        if (pendingOps.length > 0) {
          for (const op of pendingOps) {
            toast.error('Connection lost', {
              description: `${op.type} was interrupted and may not have completed.`,
            });
          }
          usePendingOperationsStore.setState({ operations: [] });
        }

        if (payload.code === 1008 || payload.code === 401) {
          handleLogout();
        } else {
          useConnectionStore.getState().setConnectionTimedOut(true);
        }
      });

      client.on('error.connection', (error) => {
        console.error('WebSocket error:', error);
      });

      subscribeToServerEvents(client, handlerContextRef);

      client.connect().catch((err) => {
        console.error('Connection failed:', err);
      });
    };

    // Pre-flight auth verification: check token validity via HTTP before
    // opening a WebSocket. This lets us surface "invalid token" immediately
    // instead of entering the retry loop with a bad token.
    HttpClient.verifyToken(serverUrl, apiToken ?? undefined).then((isValid) => {
      if (cancelled) return;

      if (!isValid) {
        useConnectionStore.getState().setAuthError(
          'Authentication failed. Your token may be invalid or expired.',
        );
        return;
      }

      createAndConnectClient();
    }).catch(() => {
      // Network error during pre-flight — fall through to WebSocket attempt.
      // The server may be reachable via WS but not HTTP (e.g., proxy issues),
      // or this could be a temporary network hiccup. Let the existing retry
      // logic handle it.
      if (cancelled) return;
      createAndConnectClient();
    });

    return () => {
      cancelled = true;
      const client = clientRef.current;
      if (client) {
        client.dispose();
        if (clientRef.current === client) {
          clientRef.current = null;
        }
      }
    };
  }, [serverUrl, apiToken, clientDescriptor, reconnectAttempt]);

  useEffect(() => {
    if (serverUrl && clientDescriptor && !connected && !connectionTimedOut) {
      const timeoutId = setTimeout(() => {
        if (!useConnectionStore.getState().connected) {
          useConnectionStore.getState().setConnectionTimedOut(true);
        }
      }, CONNECTION_TIMEOUT);

      return () => clearTimeout(timeoutId);
    }
  }, [serverUrl, apiToken, clientDescriptor, reconnectAttempt, connected, connectionTimedOut]);

  useEffect(() => {
    if (!connectionTimedOut || connected || !serverUrl) return;

    const retryCount = useConnectionStore.getState().retryCount;
    const delay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(2, retryCount),
      MAX_RETRY_DELAY,
    );

    let countdown = Math.floor(delay / 1000);
    useConnectionStore.getState().setNextRetryIn(countdown);

    const countdownInterval = setInterval(() => {
      countdown -= 1;
      useConnectionStore.getState().setNextRetryIn(Math.max(0, countdown));
    }, 1000);

    const retryTimeout = setTimeout(() => {
      useConnectionStore.getState().setRetryCount(c => c + 1);
      setReconnectAttempt(n => n + 1);
    }, delay);

    return () => {
      clearInterval(countdownInterval);
      clearTimeout(retryTimeout);
    };
  }, [serverUrl, apiToken, reconnectAttempt, connected, connectionTimedOut]);

  useEffect(() => {
    const handleOnline = () => {
      if (!serverUrl) return;

      const client = clientRef.current;
      if (client && client.connected) return;

      useConnectionStore.getState().setConnected(false);
      useConnectionStore.getState().setRetryCount(0);
      useConnectionStore.getState().setConnectionTimedOut(false);
      setReconnectAttempt(n => n + 1);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [serverUrl]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      const client = clientRef.current;
      if (client && client.ws?.readyState === WebSocket.OPEN) return;
      if (!serverUrl) return;

      useConnectionStore.getState().setRetryCount(0);
      useConnectionStore.getState().setConnectionTimedOut(false);
      setReconnectAttempt(n => n + 1);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [serverUrl]);

  useEffect(() => {
    const interval = setInterval(() => {
      usePendingOperationsStore.getState().cleanupStaleOperations();
    }, 15_000);
    return () => clearInterval(interval);
  }, []);

  return { clientRef, retry };
}
