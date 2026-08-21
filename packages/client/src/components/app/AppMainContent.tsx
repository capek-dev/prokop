import { useMemo, useCallback } from 'react';
import type {
  MessageWithParts,
  AttachmentKind,
  AskResponse,
  Message,
} from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useAskStore, type PendingAskRequest } from '@/stores/askStore';
import type { ModelInfo } from '@/handlers/serverMessage/types';
import { ConnectingState } from '@/components/shared/LoadingSkeleton';
import { OfflineState } from '@/components/shared/OfflineState';
import { ChatView } from '@/components/chat/ChatView';
import { Button } from '@/components/ui/button';
import type { MessageInputHandle } from '@/components/chat/MessageInput';
import { usePinnedMessagesQuery, usePinMessageMutation, useUnpinMessageMutation } from '@/hooks/queries';

export interface AppMainContentProps {
  serverUrl: string | null;
  sdkClient: ProkopaiClient | null;
  messagesWithParts: MessageWithParts[];
  inputRef: React.RefObject<MessageInputHandle | null>;
  onRetry: () => void;
  onLogout: () => void;
  onSendMessage: (content: string, attachments?: Array<{ id: string; kind: AttachmentKind }>) => void;
  onRemoveFromQueue: (queueItemId: string) => void;
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent: (sessionId: string) => void;
  onInterrupt: () => void;
  onRevert: (sessionId: string, messageId: string) => void;
  onFork: (sessionId: string, messageId: string) => void;
  onEditMessage: (sessionId: string, messageId: string, content: string) => void;
  onCompact: (sessionId: string) => void;
  onClearCompactionSuccess: () => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
  autoFollowToggleRef?: React.RefObject<{ toggle: () => void } | null>;
}

export function AppMainContent({
  serverUrl,
  messagesWithParts,
  inputRef,
  sdkClient,
  onRetry,
  onLogout,
  onSendMessage,
  onRemoveFromQueue,
  onAskResponse,
  onNavigateToSubagent,
  onInterrupt,
  onRevert,
  onFork,
  onEditMessage,
  onCompact,
  onClearCompactionSuccess,
  scrollToBottomRef,
  autoFollowToggleRef,
}: AppMainContentProps) {
  // Read from stores
  const connected = useConnectionStore(s => s.connected);
  const authError = useConnectionStore(s => s.authError);
  const connectionTimedOut = useConnectionStore(s => s.connectionTimedOut);
  const retryCount = useConnectionStore(s => s.retryCount);
  const nextRetryIn = useConnectionStore(s => s.nextRetryIn);
  const streamingSessionIds = useConnectionStore(s => s.streamingSessionIds);

  const currentSession = useSessionStore(s => s.currentSession);
  const queuedMessages = useSessionStore(s => s.queuedMessages);
  const currentModel = useSessionStore(s => s.currentModel);
  const compactionSuccess = useSessionStore(s => s.compactionSuccess);

  const prompts = useServerDataStore(s => s.prompts);
  const models = useServerDataStore(s => s.models) as ModelInfo[];

  const pendingAskRequests = useAskStore(s => s.pendingRequests) as PendingAskRequest[];
  const navigationIntent = useSessionStore(s => s.navigationIntent);
  const clearTargetMessageIntent = useSessionStore(s => s.clearTargetMessageIntent);
  const targetMessageId = navigationIntent.mode === 'target-message' ? navigationIntent.messageId : null;

  const activeWorkspace = useServerDataStore(s => s.activeWorkspace);
  const { data: pinnedMessages } = usePinnedMessagesQuery(sdkClient, activeWorkspace?.id);
  const pinMessageMutation = usePinMessageMutation(sdkClient, activeWorkspace?.id);
  const unpinMessageMutation = useUnpinMessageMutation(sdkClient, activeWorkspace?.id);

  const pinnedMessageIds = useMemo(
    () => new Set((pinnedMessages ?? []).map(pin => pin.messageId)),
    [pinnedMessages],
  );

  const handleTogglePinMessage = useCallback((message: Message) => {
    if (!activeWorkspace || message.role !== 'assistant') return;

    if (pinnedMessageIds.has(message.id)) {
      unpinMessageMutation.mutate({ messageId: message.id });
    } else {
      pinMessageMutation.mutate({
        sessionId: message.sessionId,
        messageId: message.id,
      });
    }
  }, [activeWorkspace, pinnedMessageIds, pinMessageMutation, unpinMessageMutation]);

  const isPinning = pinMessageMutation.isPending;
  const isUnpinning = unpinMessageMutation.isPending;

  const handleTargetMessageHandled = useCallback(() => {
    clearTargetMessageIntent();
  }, [clearTargetMessageIntent]);

  const isCompacting = currentSession?.compacting ?? false;

  const handleInterrupt = () => {
    onInterrupt();
  };

  if (!connected) {
    if (connectionTimedOut) {
      return (
        <div className="flex w-full h-full items-center justify-center bg-background">
          <OfflineState
            serverUrl={serverUrl!}
            authError={authError}
            retryCount={retryCount}
            nextRetryIn={nextRetryIn}
            onRetry={onRetry}
            onLogout={onLogout}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col w-full h-full items-center justify-center bg-background gap-4">
        <ConnectingState />
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className="text-muted-foreground"
        >
          Change Server
        </Button>
      </div>
    );
  }

  if (!currentSession) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground px-6">
        <h2 className="mb-2">Select or create a session</h2>
        <p>Choose a session from the sidebar or create a new one to start chatting.</p>
      </div>
    );
  }

  const compactable = messagesWithParts.filter(
    (m) => m.message.role !== 'system'
  );
  const canCompact = compactable.length >= 2;

  // Find the provider ID for the current model
  const currentModelInfo = models.find((m) => m.id === currentModel);

  return (
    <ChatView
      inputRef={inputRef}
      session={currentSession}
      messagesWithParts={messagesWithParts}
      queuedMessages={queuedMessages[currentSession.id] || []}
      prompts={prompts}
      onSendMessage={onSendMessage}
      onRemoveFromQueue={onRemoveFromQueue}
      pendingAskRequests={pendingAskRequests}
      onAskResponse={onAskResponse}
      modelSupportsImage={currentModelInfo?.capabilities?.input?.image ?? false}
      onNavigateToSubagent={onNavigateToSubagent}
      isStreaming={streamingSessionIds.has(currentSession.id) || !!currentSession.runningAt}
      onInterrupt={handleInterrupt}
      onRevert={onRevert}
      onFork={onFork}
      onEditMessage={onEditMessage}
      onCompact={canCompact ? () => onCompact(currentSession.id) : undefined}
      isCompacting={isCompacting}
      compactionSuccess={compactionSuccess}
      onClearCompactionSuccess={onClearCompactionSuccess}
      serverUrl={serverUrl ?? undefined}
      sdkClient={sdkClient}
      scrollToBottomRef={scrollToBottomRef}
      autoFollowToggleRef={autoFollowToggleRef}
      pinnedMessageIds={pinnedMessageIds}
      onTogglePinMessage={handleTogglePinMessage}
      isPinningMessage={isPinning || isUnpinning}
      targetMessageId={targetMessageId}
      navigationIntent={navigationIntent}
      onTargetMessageHandled={handleTargetMessageHandled}
    />
  );
}
