import { useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { Part, Message, ProkopaiClient } from '@prokopai/sdk';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { ChatView } from '@/components/chat/ChatView';
import type { MessageInputHandle } from '@/components/chat/MessageInput';
import { ChatLoadingState } from '@/components/shared/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { useSessionStore, type SessionNavigationIntent } from '@/stores/sessionStore';
import { useAskStore } from '@/stores/askStore';
import { useShallow } from 'zustand/react/shallow';
import { useSessionCommands } from '@/contexts/SessionCommandsContext';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useBoardFocus } from '@/hooks/useBoardFocus';
import {
  usePinnedMessagesQuery,
  usePinMessageMutation,
  useUnpinMessageMutation,
} from '@/hooks/queries';
import { SessionPaneHeader } from './SessionPaneHeader';
import { useSessionPaneRegistry } from '@/contexts/SessionPaneRegistryContext';
import type { SessionPaneHandle } from '@/contexts/SessionPaneRegistryContext';
import type { QueuedMessage } from '@prokopai/sdk';

const EMPTY_PARTS: Part[] = [];
const EMPTY_QUEUE: QueuedMessage[] = [];
const DEFAULT_NAV_INTENT: SessionNavigationIntent = { mode: 'follow' };

export interface SessionPaneProps {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
  isFocused: boolean;
  isCompact: boolean;
  showPaneChrome: boolean;
  onRemoveFromBoard?: (sessionId: string) => void;
  onCloseOthers?: () => void;
  onCloseAll?: () => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  setDragActivatorNode?: (element: HTMLButtonElement | null) => void;
}

export function SessionPane({
  sessionId,
  sdkClient,
  serverUrl,
  isFocused,
  isCompact: _isCompact,
  showPaneChrome,
  onRemoveFromBoard,
  onCloseOthers,
  onCloseAll,
  dragAttributes,
  dragListeners,
  setDragActivatorNode,
}: SessionPaneProps) {
  const commands = useSessionCommands();

  const session = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId));
  const contentMeta = useSessionStore(s => s.contentMetaBySession[sessionId]);
  const sessionMessages = useSessionStore(s => s.messagesBySession[sessionId]);
  const sessionParts = useSessionStore(s => s.partsBySession[sessionId]);
  const compactionSuccess = useSessionStore(s => s.compactionSuccessBySessionId[sessionId] ?? false);
  const navigationIntent = useSessionStore(s => s.navigationIntentBySessionId[sessionId] ?? DEFAULT_NAV_INTENT);
  const queuedMessages = useSessionStore(s => s.queuedMessages[sessionId] ?? EMPTY_QUEUE);
  const sessionModel = useSessionStore(s => s.modelBySessionId[sessionId] ?? s.sessions.find(sess => sess.id === sessionId)?.selectedModel ?? '');
  const pendingAskRequests = useAskStore(
    useShallow(s => s.pendingRequests.filter(r => r.sessionId === sessionId || r.originSessionId === sessionId)),
  );
  const prompts = useServerDataStore(s => s.prompts);
  const models = useServerDataStore(s => s.models);

  // Pane-scoped pinned messages: resolve the session's workspaceId and
  // query pin state for that workspace. Each pane builds its own pin set,
  // so pin/unpin mutations always target the message's actual workspace.
  const workspaceId = session?.workspaceId ?? null;
  const { data: pinnedMessages } = usePinnedMessagesQuery(sdkClient, workspaceId);
  const pinMessageMutation = usePinMessageMutation(sdkClient, workspaceId);
  const unpinMessageMutation = useUnpinMessageMutation(sdkClient, workspaceId);

  const pinnedMessageIds = useMemo(
    () => new Set((pinnedMessages ?? []).map(pin => pin.messageId)),
    [pinnedMessages],
  );

  const handleTogglePinMessage = useCallback((message: Message) => {
    if (!workspaceId || message.role !== 'assistant') return;
    if (pinnedMessageIds.has(message.id)) {
      unpinMessageMutation.mutate({ messageId: message.id });
    } else {
      pinMessageMutation.mutate({
        sessionId: message.sessionId,
        messageId: message.id,
      });
    }
  }, [workspaceId, pinnedMessageIds, pinMessageMutation, unpinMessageMutation]);

  const isPinningMessage = pinMessageMutation.isPending || unpinMessageMutation.isPending;

  const scrollToBottomRef = useRef<(() => void) | null>(null);
  const autoFollowToggleRef = useRef<{ toggle: () => void } | null>(null);

  const messagesWithParts = useMemo(
    () => (sessionMessages ?? []).map((message) => ({
      message,
      parts: sessionParts?.[message.id] ?? EMPTY_PARTS,
    })),
    [sessionMessages, sessionParts],
  );

  const inputRef = useRef<MessageInputHandle>(null);

  const handle = useMemo<SessionPaneHandle>(() => ({
    focusInput: () => {
      inputRef.current?.focus();
    },
    scrollToBottom: () => {
      scrollToBottomRef.current?.();
    },
    toggleAutoFollow: () => {
      autoFollowToggleRef.current?.toggle();
    },
  }), []);

  const registry = useSessionPaneRegistry();

  useLayoutEffect(() => {
    registry.register(sessionId, handle);
    return () => {
      registry.unregister(sessionId);
    };
  }, [sessionId, handle, registry]);

  const handleRemove = useCallback(() => {
    onRemoveFromBoard?.(sessionId);
  }, [sessionId, onRemoveFromBoard]);

  const focusBoard = useBoardFocus();

  const handleFocusPane = useCallback(() => {
    focusBoard(sessionId);
  }, [sessionId, focusBoard]);

  const handleSendMessage = useCallback((
    content: string,
    attachments?: Array<{ id: string; kind: import('@prokopai/sdk').AttachmentKind }>,
    responseFormatId?: string,
    goal?: { condition: string; maxTurns?: number },
  ) => {
    commands.sendChatMessageForSession(sessionId, content, attachments, responseFormatId, goal);
  }, [commands, sessionId]);

  const handleInterrupt = useCallback(() => {
    commands.handleInterruptSessionById(sessionId);
  }, [commands, sessionId]);

  const isCompacting = session?.compacting ?? false;
  const isStreaming = useConnectionStore(s => s.streamingSessionIds.has(sessionId)) || !!session?.runningAt;
  const sessionModelInfo = models.find(m => m.id === sessionModel);
  const modelSupportsImage = sessionModelInfo?.capabilities?.input?.image ?? false;
  const targetMessageId = navigationIntent.mode === 'target-message' ? navigationIntent.messageId : null;

  if (!session) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 text-muted-foreground">
        <AlertCircle className="size-6" />
        <p className="text-xs">Session not found</p>
      </div>
    );
  }

  const contentStatus = contentMeta?.status ?? 'unloaded';

  const content = (
    <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      {contentStatus === 'loading' && (
        <ChatLoadingState />
      )}
      {contentStatus === 'error' && (
        <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-xs">{contentMeta?.error || 'Failed to load'}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => commands.resumeSession(sessionId)}
          >
            <RefreshCw className="size-3" />
            Retry
          </Button>
        </div>
      )}
      {(contentStatus === 'ready' || contentStatus === 'unloaded') && (
        <ChatView
          session={session}
          messagesWithParts={messagesWithParts}
          queuedMessages={queuedMessages}
          prompts={prompts}
          modelSupportsImage={modelSupportsImage}
          inputRef={inputRef}
          onSendMessage={handleSendMessage}
          onRemoveFromQueue={commands.removeFromQueue}
          pendingAskRequests={pendingAskRequests}
          onAskResponse={commands.handleAskResponse}
          onNavigateToSubagent={commands.resumeSession}
          isStreaming={isStreaming}
          onInterrupt={handleInterrupt}
          onRevert={commands.revertSession}
          onFork={commands.forkSession}
          onEditMessage={commands.editMessage}
          onCompact={() => commands.compactSession(sessionId)}
          isCompacting={isCompacting}
          compactionSuccess={compactionSuccess}
          onClearCompactionSuccess={() => useSessionStore.getState().setCompactionSuccessForSession(sessionId, false)}
          serverUrl={serverUrl ?? undefined}
          sdkClient={sdkClient}
          scrollToBottomRef={scrollToBottomRef}
          autoFollowToggleRef={autoFollowToggleRef}
          pinnedMessageIds={pinnedMessageIds}
          onTogglePinMessage={handleTogglePinMessage}
          isPinningMessage={isPinningMessage}
          targetMessageId={targetMessageId}
          navigationIntent={navigationIntent}
          onTargetMessageHandled={() => useSessionStore.getState().setNavigationIntentForSession(sessionId, { mode: 'free' })}
          onClaimControl={commands.claimControl}
        />
      )}
    </div>
  );

  if (!showPaneChrome) {
    return (
      <div
        className="flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden"
        onMouseDown={handleFocusPane}
      >
        {content}
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 max-w-full flex-col overflow-hidden md:rounded-lg ${
        isFocused
          ? 'bg-card'
          : 'bg-background/50'
      }`}
      onMouseDown={handleFocusPane}
    >
      <SessionPaneHeader
        sessionId={sessionId}
        isFocused={isFocused}
        onRemove={handleRemove}
        onCloseOthers={onCloseOthers}
        onCloseAll={onCloseAll}
        dragAttributes={dragAttributes}
        dragListeners={dragListeners}
        setDragActivatorNode={setDragActivatorNode}
      />
      {content}
    </div>
  );
}
