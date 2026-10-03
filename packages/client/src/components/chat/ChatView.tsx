import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Lock, Eye, ArrowDown, ShieldOff, Shield } from 'lucide-react';
import type { ProkopaiClient, Message } from '@prokopai/sdk';
import type { Session, MessageWithParts, QueuedMessage, AttachmentKind, AskResponse } from '@prokopai/sdk';
import { MessageInput } from './MessageInput';
import type { MessageInputHandle } from './MessageInput';
import { Button } from '@/components/ui/button';
import { VirtualizedTranscript } from './VirtualizedTranscript';
import { PendingAskDock } from './PendingAskDock';
import type { PendingAskRequest } from '@/stores/askStore';
import { useSessionControlStore, type ActionRejection } from '@/stores/sessionControlStore';
import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import { useSessionStore, type SessionNavigationIntent } from '@/stores/sessionStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import { useTranscriptPagination } from '@/hooks/useTranscriptPagination';
import { RetryStatus } from './RetryStatus';
import { UserPromptMap } from './UserPromptMap';
import { EmptySessionCheckout } from './EmptySessionCheckout';
import { DeferredConversation } from './DeferredConversation';

export interface DisplayItem {
  message: import('@prokopai/sdk').Message;
  parts: import('@prokopai/sdk').Part[];
  isQueued?: boolean;
  queueId?: string;
}

interface ChatViewProps {
  session: Session;
  messagesWithParts: MessageWithParts[];
  queuedMessages: QueuedMessage[];
  prompts?: import('@prokopai/sdk').PromptInfo[];
  onSendMessage: (content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>, responseFormatId?: string, goal?: { condition: string; maxTurns?: number; tokenBudget?: number }) => void;
  onRemoveFromQueue: (queueId: string) => void;
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  modelSupportsImage?: boolean;
  onNavigateToSubagent?: (sessionId: string) => void;
  isStreaming?: boolean;
  onInterrupt?: () => void;
  onRevert?: (sessionId: string, stepPartId: string) => void;
  onFork?: (sessionId: string, messageId: string) => void;
  onEditMessage?: (sessionId: string, messageId: string, content: string) => void;
  onCompact?: () => void;
  isCompacting?: boolean;
  compactionSuccess?: boolean;
  onClearCompactionSuccess?: () => void;
  serverUrl?: string;
  sdkClient?: ProkopaiClient | null;
  inputRef?: React.RefObject<MessageInputHandle | null>;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
  autoFollowToggleRef?: React.RefObject<{ toggle: () => void } | null>;
  pinnedMessageIds?: Set<string>;
  onTogglePinMessage?: (message: Message) => void;
  isPinningMessage?: boolean;
  targetMessageId?: string | null;
  navigationIntent?: SessionNavigationIntent;
  onTargetMessageHandled?: () => void;
  onNavigateToMessage?: (messageId: string) => void;
  onClaimControl?: (sessionId: string) => void;
}

function mergeMessagesWithQueue(
  messagesWithParts: MessageWithParts[],
  queuedMessages: QueuedMessage[],
  getUrl: (sessionId: string, attachmentId: string, key: string) => string
): DisplayItem[] {
  const regularItems: DisplayItem[] = messagesWithParts.map(mwp => ({
    message: mwp.message,
    parts: mwp.parts,
    isQueued: false,
  }));

  const queuedItems: DisplayItem[] = queuedMessages.map(qm => {
    const attachmentParts = (qm.attachments || []).map(att => {
      const url = getUrl(qm.sessionId, att.id, att.accessKey ?? '');
      if (att.kind === 'image') {
        return {
          id: `${qm.id}-att-${att.id}`,
          messageId: qm.id,
          createdAt: qm.createdAt,
          type: 'image' as const,
          url,
          mimeType: att.mimeType,
        };
      }
      return {
        id: `${qm.id}-att-${att.id}`,
        messageId: qm.id,
        createdAt: qm.createdAt,
        type: 'file' as const,
        url,
        mimeType: att.mimeType || '',
        filename: att.filename,
      };
    });

    return {
      message: {
        id: qm.id,
        role: 'user' as const,
        sessionId: qm.sessionId,
        createdAt: qm.createdAt,
      },
      parts: [
        ...attachmentParts,
        ...(qm.content.trim() ? [{
          id: `${qm.id}-part`,
          messageId: qm.id,
          createdAt: qm.createdAt,
          type: 'text' as const,
          text: qm.content,
        }] : []),
      ],
      isQueued: true,
      queueId: qm.id,
    };
  });

  // Sort regular messages by createdAt, then append queued messages at the end
  const sortedRegularItems = [...regularItems].sort((a, b) =>
    a.message.createdAt - b.message.createdAt
  );

  // Sort queued items by position (or createdAt as fallback) to maintain order
  const sortedQueuedItems = [...queuedItems].sort((a, b) =>
    a.message.createdAt - b.message.createdAt
  );

  return [...sortedRegularItems, ...sortedQueuedItems];
}

export function ChatView(props: ChatViewProps) {
  return (
    <DeferredConversation key={props.session.id}>
      <ChatViewContent {...props} />
    </DeferredConversation>
  );
}

function ChatViewContent({
  session,
  messagesWithParts,
  queuedMessages,
  prompts,
  onSendMessage,
  onRemoveFromQueue,
  pendingAskRequests,
  onAskResponse,
  modelSupportsImage,
  onNavigateToSubagent,
  isStreaming,
  onInterrupt,
  onRevert: _onRevert,
  onFork: _onFork,
  onEditMessage: _onEditMessage,
  onCompact,
  isCompacting,
  compactionSuccess,
  onClearCompactionSuccess,
  serverUrl,
  sdkClient,
  inputRef,
  scrollToBottomRef,
  autoFollowToggleRef,
  pinnedMessageIds,
  onTogglePinMessage,
  isPinningMessage,
  targetMessageId,
  navigationIntent = { mode: 'follow' },
  onTargetMessageHandled,
  onNavigateToMessage,
  onClaimControl,
}: ChatViewProps) {
  const isPrimarySession = !session.parentId;
  const isMainActiveSession = isPrimarySession && session.status === 'active';
  const compactPending = usePendingOperationsStore(s => s.operations.some(op =>
    op.sessionId === session.id && op.type === 'compact'));
  const harnessState = session.harnessState;
  const nativeApprovalPrefix = harnessState?.nativeApprovalPrefix;
  const compactUncertain = harnessState?.compaction.uncertain === true
    && !compactPending && !isCompacting;
  const compactBusy = isCompacting || compactPending || harnessState?.compaction.pending === true;
  const goalUncertain = harnessState?.goalUncertain === true;
  const inputLocked = compactBusy || compactUncertain || goalUncertain;

  const contentMeta = useSessionStore((state) => state.contentMetaBySession[session.id]);
  const { loadOlder } = useTranscriptPagination({ sessionId: session.id, client: sdkClient ?? null });

  const controlState = useSessionControlStore((s) => s.controlBySessionId[session.id]);
  const askControls = useSessionControlStore((s) => s.controlBySessionId);
  const myClientId = useClientIdentityStore((s) => s.clientId);
  const isObserver = controlState?.status === 'controlled' && controlState.controllerClientId !== myClientId;
  // Observers see a read-only transcript: mutation callbacks are withheld so
  // revert/fork/edit/compact/queue-remove affordances never render.
  const readOnlyTranscript = isObserver;
  const onRevertForMode = readOnlyTranscript ? undefined : _onRevert;
  const onForkForMode = readOnlyTranscript ? undefined : _onFork;
  const onEditMessageForMode = readOnlyTranscript ? undefined : _onEditMessage;
  const onCompactForMode = readOnlyTranscript ? undefined : onCompact;
  const onRemoveFromQueueForMode = readOnlyTranscript || harnessState?.capabilities.canRemoveQueuedMessages === false
    ? undefined : onRemoveFromQueue;
  // The server derives the fork state from the harness and its metadata:
  // restricted modes carry the reason, so the affordance renders disabled
  // instead of failing the click.
  const forkUnavailableReason = harnessState?.fork.mode === 'restricted' && !readOnlyTranscript
    ? harnessState.fork.reason
    : undefined;

  const [rejectionNotice, setRejectionNotice] = useState<string | null>(null);
  const rejectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Native harness approvals stay answerable only by the controlling client,
  // keyed by the session the approval belongs to.
  const canAnswerNative = useCallback((requestSessionId: string) => {
    const control = askControls[requestSessionId];
    return myClientId !== null
      && control?.status === 'controlled'
      && control.controllerClientId === myClientId;
  }, [askControls, myClientId]);

  const showRejectionNotice = useCallback((message: string) => {
    if (rejectionTimerRef.current) {
      clearTimeout(rejectionTimerRef.current);
    }
    setRejectionNotice(message);
    rejectionTimerRef.current = setTimeout(() => {
      setRejectionNotice(null);
      rejectionTimerRef.current = null;
    }, 4_000);
  }, []);

  useEffect(() => {
    return () => {
      if (rejectionTimerRef.current) {
        clearTimeout(rejectionTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let lastRejection: ActionRejection | null = null;
    const unsub = useSessionControlStore.subscribe((state) => {
      if (state.lastActionRejection !== lastRejection) {
        lastRejection = state.lastActionRejection;
        if (lastRejection && lastRejection.sessionId === session.id) {
          showRejectionNotice(lastRejection.message);
        }
      }
    });
    return unsub;
  }, [session.id, showRejectionNotice]);

  const [autoFollow, setAutoFollow] = useState(navigationIntent.mode === 'follow');

  useLayoutEffect(() => {
    setAutoFollow(navigationIntent.mode === 'follow');
  }, [session.id, navigationIntent.mode]);

  const handleToggleAutoFollow = useCallback(() => {
    setAutoFollow((prev) => {
      const newValue = !prev;
      if (newValue) {
        scrollToBottomRef?.current?.();
      }
      return newValue;
    });
  }, [scrollToBottomRef]);

  // Expose toggle function via ref for keyboard shortcuts
  useEffect(() => {
    if (autoFollowToggleRef) {
      autoFollowToggleRef.current = {
        toggle: () => {
          handleToggleAutoFollow();
        },
      };
    }
  }, [autoFollowToggleRef, handleToggleAutoFollow]);

  const displayItems = useMemo(
    () => mergeMessagesWithQueue(
      messagesWithParts,
      queuedMessages,
      sdkClient?.http.attachments.getUrl ?? ((sessionId, attachmentId, key) =>
        `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachmentId)}/content?key=${encodeURIComponent(key)}`
      )
    ),
    [messagesWithParts, queuedMessages, sdkClient]
  );

  return (
    <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      {/* Transcript area with floating auto-follow button */}
      <div className="relative flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
        {/* Virtualized transcript - handles scrolling for messages only */}
        <VirtualizedTranscript
          displayItems={displayItems}
          messagesWithParts={messagesWithParts}
          sessionId={session.id}
          sessionStatus={session.status}
          isCompacting={compactBusy}
          compactedAfterMessageId={harnessState?.compaction.boundaryMessageId ?? undefined}
          compactionSuccess={compactionSuccess}
          onClearCompactionSuccess={onClearCompactionSuccess}
          onNavigateToSubagent={onNavigateToSubagent}
          onRemoveFromQueue={onRemoveFromQueueForMode}
          onRevert={onRevertForMode}
          onFork={onForkForMode}
          assistantOnlyFork={harnessState?.fork.mode === 'assistant-only'}
          forkUnavailableReason={forkUnavailableReason}
          onEditMessage={onEditMessageForMode}
          onCompact={onCompactForMode}
          isMainActiveSession={isMainActiveSession}
          autoFollow={autoFollow}
          onAutoScrollChange={setAutoFollow}
          scrollToBottomRef={scrollToBottomRef}
          serverUrl={serverUrl}
          pinnedMessageIds={pinnedMessageIds}
          onTogglePinMessage={onTogglePinMessage}
          isPinningMessage={isPinningMessage}
          targetMessageId={targetMessageId}
          onTargetMessageHandled={onTargetMessageHandled}
          hasOlder={contentMeta?.hasOlder}
          isLoadingOlder={contentMeta?.isLoadingOlder}
          loadOlderError={contentMeta?.loadOlderError}
          onLoadOlder={loadOlder}
          emptyContent={isMainActiveSession && !isObserver
            ? <EmptySessionCheckout />
            : undefined}
        />

        {onNavigateToMessage && (
          <UserPromptMap
            displayItems={displayItems}
            targetMessageId={targetMessageId}
            onNavigate={onNavigateToMessage}
          />
        )}

        {/* Floating auto-follow toggle button - positioned within transcript area */}
        <button
          onClick={handleToggleAutoFollow}
          className="absolute bottom-4 right-4 z-50 flex items-center p-1.5 text-xs rounded-full transition-colors cursor-pointer bg-background/80 backdrop-blur-sm hover:bg-background border border-border/50 shadow-sm pointer-events-auto"
          title={autoFollow ? 'Auto-follow enabled (Cmd+Shift+F)' : 'Auto-follow disabled (Cmd+Shift+F)'}
        >
          {autoFollow ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <Eye className="size-3.5" />
          )}
        </button>
      </div>

      <PendingAskDock
        sessionId={session.id}
        requests={pendingAskRequests}
        nativeApprovalPrefix={nativeApprovalPrefix}
        canAnswerNative={canAnswerNative}
        onRespond={onAskResponse}
      />

      {session.status === 'active' && <RetryStatus sessionId={session.id} />}

      {compactUncertain && (
        <div role="alert" className="px-4 py-2 text-center text-xs text-warning bg-warning/10">
          Claude compaction outcome unknown. This session is locked to avoid replay. Start a new session to continue.
        </div>
      )}
      {goalUncertain && (
        <div role="alert" className="px-4 py-2 text-center text-xs text-warning bg-warning/10">
          Claude Goal outcome unknown. This session is locked to avoid replay. Start a new session to continue.
        </div>
      )}

      {session.status === 'active' && !session.parentId && !isObserver && (
        <MessageInput
          ref={inputRef}
          onSendMessage={onSendMessage}
          disabled={inputLocked}
          workspaceId={session.workspaceId}
          sdkClient={sdkClient}
          prompts={prompts}
          sessionId={session.id}
          modelSupportsImage={modelSupportsImage}
          isStreaming={isStreaming}
          onStopStreaming={onInterrupt}
          session={session}
          checkoutLocked={displayItems.length > 0}
        />
      )}

      {session.status === 'active' && !session.parentId && isObserver && (
        <div className="bg-muted/40 px-4 py-3 flex items-center justify-center gap-3">
          <Eye className="size-4 text-muted-foreground shrink-0" />
          <span className="text-sm text-muted-foreground text-center">
            You are viewing this session. Another client is in control.
          </span>
          {onClaimControl && myClientId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onClaimControl(session.id)}
              className="shrink-0"
            >
              <Shield className="size-4" data-icon="inline-start" />
              Take control
            </Button>
          )}
        </div>
      )}

      {session.parentId && (
        <div className="p-4 bg-muted/50 text-center flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Lock className="size-4" />
          This is a subagent session (read-only)
          {harnessState?.capabilities.canInterruptSubagent && session.subagentStatus === 'running'
            && !isObserver && onInterrupt && (
            <Button variant="outline" size="sm" onClick={onInterrupt}>Stop agent</Button>
          )}
        </div>
      )}

      {rejectionNotice && (
        <div className="px-4 py-2 border-t border-warning/25 bg-warning/10 text-center flex items-center justify-center gap-2 text-xs text-warning">
          <ShieldOff className="size-3.5" />
          {rejectionNotice}
        </div>
      )}
    </div>
  );
}
