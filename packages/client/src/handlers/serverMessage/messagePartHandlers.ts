import { getTerminalNotificationEventId } from '@prokopai/sdk';
import type { CompactionCompleteMessage, Message, Part, ToolPart } from '@prokopai/sdk';
import type { SessionHandlersContext, SessionUsage } from './types';
import { useSessionStore } from '@/stores/sessionStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { toast } from 'sonner';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useChatRetryStore } from '@/stores/chatRetryStore';

export const STREAM_FLUSH_INTERVAL_MS = 75;

const FILE_MUTATING_TOOLS = new Set([
  'edit', 'multiedit', 'write-file', 'apply-patch', 'shell',
]);

const SCHEDULER_TOOLS = new Set(['scheduler']);

function invalidateFileQueries(): void {
  queryClient.invalidateQueries({ queryKey: queryKeys.files.browsePrefix });
  queryClient.invalidateQueries({ queryKey: queryKeys.files.treePrefix });
  queryClient.invalidateQueries({ queryKey: queryKeys.files.searchPrefix });
  queryClient.invalidateQueries({ queryKey: queryKeys.files.gitStatusPrefix });
}

function invalidateSchedulerQueries(): void {
  queryClient.invalidateQueries({ queryKey: ['scheduledJobs'] });
}

export function handleMessageCreated(
  msg: { type: 'message.created'; message: Message },
  ctx: SessionHandlersContext,
): void {
  const { message } = msg;
  const {
    setMessagesBySession,
    setPartsBySession,
    addStreamingSession,
    removeInterruptedSession,
    clearCompletion,
  } = ctx;

  // Clear completion state when activity happens in this session
  clearCompletion(message.sessionId);

  // Write to any session that has content loaded (multi-pane safe)
  const hasContent = useSessionStore.getState().messagesBySession[message.sessionId] !== undefined;
  if (hasContent) {
    setMessagesBySession(prev => ({
      ...prev,
      [message.sessionId]: [...(prev[message.sessionId] || []), message],
    }));
    setPartsBySession(prev => ({
      ...prev,
      [message.sessionId]: {
        ...prev[message.sessionId],
        [message.id]: [],
      },
    }));
  }

  if (hasContent && 'status' in message && message.status === 'streaming') {
    addStreamingSession(message.sessionId);
    removeInterruptedSession(message.sessionId);
  }
}

export function handleMessageUpdated(
  msg: { type: 'message.updated'; message: Message },
  ctx: SessionHandlersContext,
): void {
  const { message } = msg;
  const {
    setMessagesBySession,
    removeStreamingSession,
    partAppendRafRef,
    partAppendTimeoutRef,
    flushPendingPartAppends,
    sessionsRef,
    setCompletion,
    chatFinishSoundEnabledRef,
    playChatFinishSound,
    currentSessionIdRef,
    acknowledgeNotification,
    clearCompletion,
  } = ctx;

  // Write to any session that has content loaded (multi-pane safe)
  const hasContent = useSessionStore.getState().messagesBySession[message.sessionId] !== undefined;
  if (hasContent) {
    if ('status' in message && message.status !== 'streaming') {
      if (partAppendRafRef.current !== null) {
        cancelAnimationFrame(partAppendRafRef.current);
        partAppendRafRef.current = null;
      }
      if (partAppendTimeoutRef.current !== null) {
        clearTimeout(partAppendTimeoutRef.current);
        partAppendTimeoutRef.current = null;
      }
      flushPendingPartAppends();
    }
    setMessagesBySession(prev => ({
      ...prev,
      [message.sessionId]: (prev[message.sessionId] || []).map(m =>
        m.id === message.id ? message : m
      ),
    }));
  }

  if ('status' in message && message.status !== 'streaming') {
    removeStreamingSession(message.sessionId);
    useChatRetryStore.getState().clearRetry(message.sessionId);

    if (message.role === 'assistant' && message.mode === 'retry_failed') {
      clearCompletion(message.sessionId);
      return;
    }

    const session = sessionsRef.current.find(s => s.id === message.sessionId);
    const isTopLevel = session && session.parentId === null;

    if (isTopLevel) {
      const isError = 'error' in message && message.status === 'error';
      const flashStartedAt = Date.now();
      setCompletion(message.sessionId, { type: 'flash-only', flashStartedAt });
      if (!isError && chatFinishSoundEnabledRef.current) {
        playChatFinishSound();
      }

      const isDisplayed = useSessionBoardStore.getState().openSessionIds.includes(message.sessionId)
        || currentSessionIdRef.current === message.sessionId;

      if (
        message.role === 'assistant'
        && (message.status === 'completed' || message.status === 'error')
        && !message.summary
        && message.mode !== 'compaction'
        && hasContent
        && isDisplayed
        && document.visibilityState === 'visible'
        && document.hasFocus()
      ) {
        const eventId = getTerminalNotificationEventId(message.id, message.status);
        acknowledgeNotification(eventId, message.sessionId);
      }
    }
  }
}

export function handlePartCreated(
  msg: { type: 'part.created'; sessionId: string; part: Part },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, part } = msg;
  const { setPartsBySession, partIdIndexRef, clearCompletion } = ctx;

  clearCompletion(sessionId);

  // Write to any session that has content loaded (multi-pane safe)
  const hasContent = useSessionStore.getState().partsBySession[sessionId] !== undefined;
  if (hasContent) {
    setPartsBySession(prev => {
      const sessionParts = prev[sessionId] || {};
      const messageParts = sessionParts[part.messageId] || [];
      return {
        ...prev,
        [sessionId]: {
          ...sessionParts,
          [part.messageId]: [...messageParts, part],
        },
      };
    });

    let newIndex = 0;
    for (const entry of partIdIndexRef.current.values()) {
      if (entry.sessionId === sessionId && entry.messageId === part.messageId) {
        newIndex = Math.max(newIndex, entry.index + 1);
      }
    }
    partIdIndexRef.current.set(part.id, {
      sessionId,
      messageId: part.messageId,
      index: newIndex,
    });
  }
}

export function handlePartUpdated(
  msg: { type: 'part.updated'; sessionId: string; part: Part },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, part } = msg;
  const { setPartsBySession, partIdIndexRef, clearCompletion } = ctx;

  clearCompletion(sessionId);

  // Write to any session that has content loaded (multi-pane safe)
  const hasContent = useSessionStore.getState().partsBySession[sessionId] !== undefined;
  if (hasContent) {
    const partLocation = partIdIndexRef.current.get(part.id);
    if (partLocation) {
      setPartsBySession(prev => {
        const sessionParts = prev[partLocation.sessionId];
        if (!sessionParts) return prev;
        const messageParts = sessionParts[partLocation.messageId];
        if (!messageParts) return prev;
        const updatedMessageParts = [...messageParts];
        updatedMessageParts[partLocation.index] = part;
        return {
          ...prev,
          [partLocation.sessionId]: {
            ...sessionParts,
            [partLocation.messageId]: updatedMessageParts,
          },
        };
      });
    } else {
      setPartsBySession(prev => {
        const sessionParts = prev[sessionId] || {};
        const messageParts = sessionParts[part.messageId] || [];
        return {
          ...prev,
          [sessionId]: {
            ...sessionParts,
            [part.messageId]: messageParts.map(p => p.id === part.id ? part : p),
          },
        };
      });
    }
  }

  if (part.type === 'tool') {
    const toolPart = part as ToolPart;
    if (
      FILE_MUTATING_TOOLS.has(toolPart.name) &&
      (toolPart.state.status === 'completed' ||
        toolPart.state.status === 'error' ||
        toolPart.state.status === 'interrupted')
    ) {
      invalidateFileQueries();
    }
    if (
      SCHEDULER_TOOLS.has(toolPart.name) &&
      (toolPart.state.status === 'completed' ||
        toolPart.state.status === 'error' ||
        toolPart.state.status === 'interrupted')
    ) {
      invalidateSchedulerQueries();
    }
  }
}

export function handlePartAppend(
  msg: { type: 'part.append'; sessionId: string; partId: string; field: 'text' | 'reasoning'; delta: string },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, partId, delta } = msg;
  const {
    addStreamingSession,
    pendingPartAppendsRef,
    partAppendRafRef,
    partAppendTimeoutRef,
    lastPartAppendFlushAtRef,
    interruptedSessions,
    flushPendingPartAppends,
    clearCompletion,
  } = ctx;

  // Clear completion state when activity happens in this session
  clearCompletion(sessionId);

  if (!interruptedSessions.has(sessionId)) {
    addStreamingSession(sessionId);
  }

  // Write to any session that has content loaded (multi-pane safe)
  const hasContent = useSessionStore.getState().partsBySession[sessionId] !== undefined;
  if (hasContent) {
    const existing = pendingPartAppendsRef.current.get(partId);
    pendingPartAppendsRef.current.set(partId, (existing || '') + delta);

    // Throttle store flushes: leading flush when the interval elapsed, then a
    // single trailing timer. Keeps streaming markdown re-parses off the 60fps
    // frame budget; message completion paths still flush immediately.
    if (partAppendRafRef.current === null && partAppendTimeoutRef.current === null) {
      const elapsed = Date.now() - lastPartAppendFlushAtRef.current;
      if (elapsed >= STREAM_FLUSH_INTERVAL_MS) {
        partAppendRafRef.current = requestAnimationFrame(() => {
          flushPendingPartAppends();
        });
      } else {
        partAppendTimeoutRef.current = window.setTimeout(() => {
          partAppendTimeoutRef.current = null;
          flushPendingPartAppends();
        }, STREAM_FLUSH_INTERVAL_MS - elapsed);
      }
    }
  }
}

export function handleChatUsage(
  msg: { type: 'chat.usage'; sessionId: string; usage: SessionUsage; model: string },
  ctx: SessionHandlersContext,
): void {
  const { sessionId, usage, model } = msg;
  const { setUsageForSession, setModelForSession } = ctx;

  setUsageForSession(sessionId, {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    noCacheTokens: usage.noCacheTokens,
  });
  setModelForSession(sessionId, model);
}

export function handleCompactionComplete(
  msg: { type: 'compaction.complete'; sessionId: string; tokensUsed: CompactionCompleteMessage['tokensUsed'] },
  ctx: SessionHandlersContext,
): void {
  const { sessionId } = msg;
  const { setCompactionSuccessForSession } = ctx;

  usePendingOperationsStore.getState().clearOperation(sessionId, 'compact');

  setCompactionSuccessForSession(sessionId, true);
}

export function handleError(
  msg: { type: 'error'; code: string; message: string; sessionId?: string },
  _ctx: SessionHandlersContext,
): void {
  console.error('Server error:', msg.code, msg.message);

  if (msg.sessionId) {
    const pendingOps = usePendingOperationsStore.getState().getSessionPendingOperations(msg.sessionId);
    if (pendingOps.length > 0) {
      const ERROR_CODE_LABELS: Record<string, string> = {
        fork_error: 'Fork',
        revert_error: 'Revert',
        edit_error: 'Edit',
        compaction_error: 'Compact',
        title_generation_error: 'Title generation',
        delete_error: 'Delete',
        rename_error: 'Rename',
      };
      const label = ERROR_CODE_LABELS[msg.code] ?? 'Operation';
      toast.error(`${label} failed`, { description: msg.message });
      usePendingOperationsStore.getState().clearSessionOperations(msg.sessionId);
    } else {
      toast.error(msg.message);
    }
  } else {
    toast.error(msg.message);
  }
}

export const messagePartHandlers = {
  'message.created': handleMessageCreated,
  'message.updated': handleMessageUpdated,
  'part.created': handlePartCreated,
  'part.updated': handlePartUpdated,
  'part.append': handlePartAppend,
  'chat.usage': handleChatUsage,
  'compaction.complete': handleCompactionComplete,
  'error': handleError,
} as const;
