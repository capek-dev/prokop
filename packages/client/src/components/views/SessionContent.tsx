import { useMemo, useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import type { Part } from '@prokopai/sdk';
import { useViewRefs } from '@/contexts/ViewRefsContext';
import { useSessionManager } from '@/contexts/SessionManagerContext';
import { AppMainContent } from '@/components/app/AppMainContent';
import { ChatLoadingState } from '@/components/shared/LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/stores/sessionStore';
import { mark } from '@/lib/perf';

const EMPTY_PARTS: Part[] = [];

export default function SessionContent() {
  const sessionManager = useSessionManager();
  const { chatInputRef, scrollToBottomRef, autoFollowToggleRef } = useViewRefs();

  const {
    sdkClient,
    serverUrl,
    currentSession,
    isSessionLoading,
    resumeSession,
    revertSession,
    forkSession,
    editMessage,
    compactSession,
    removeFromQueue,
    sendChatMessage,
    handleAskResponse,
    handleInterruptSession,
    setCompactionSuccess,
  } = sessionManager;

  const contentMeta = useSessionStore((state) =>
    currentSession ? state.contentMetaBySession[currentSession.id] : undefined,
  );
  const activeSessionMessages = useSessionStore((state) =>
    currentSession ? state.messagesBySession[currentSession.id] : undefined,
  );
  const activeSessionParts = useSessionStore((state) =>
    currentSession ? state.partsBySession[currentSession.id] : undefined,
  );
  const messagesWithParts = useMemo(
    () => (activeSessionMessages ?? []).map((message) => ({
      message,
      parts: activeSessionParts?.[message.id] ?? EMPTY_PARTS,
    })),
    [activeSessionMessages, activeSessionParts],
  );

  useEffect(() => {
    if (currentSession) {
      mark('session-navigation:start');
    }
  }, [currentSession?.id]);

  if (isSessionLoading) {
    return <ChatLoadingState />;
  }

  if (!currentSession) {
    return null;
  }

  const contentStatus = contentMeta?.status ?? 'unloaded';

  if (contentStatus === 'loading') {
    return <ChatLoadingState />;
  }

  if (contentStatus === 'error') {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 text-muted-foreground">
        <AlertCircle className="size-8 text-destructive" />
        <p className="text-sm">{contentMeta?.error || 'Failed to load conversation'}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => resumeSession(currentSession.id)}
        >
          <RefreshCw className="size-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <AppMainContent
      sdkClient={sdkClient}
      inputRef={chatInputRef}
      messagesWithParts={messagesWithParts}
      serverUrl={serverUrl}
      onRetry={sessionManager.handleRetry}
      onLogout={sessionManager.handleLogout}
      onSendMessage={sendChatMessage}
      onRemoveFromQueue={removeFromQueue}
      onAskResponse={handleAskResponse}
      onNavigateToSubagent={resumeSession}
      onInterrupt={handleInterruptSession}
      onRevert={revertSession}
      onFork={forkSession}
      onEditMessage={editMessage}
      onCompact={compactSession}
      onClearCompactionSuccess={() => setCompactionSuccess(false)}
      scrollToBottomRef={scrollToBottomRef}
      autoFollowToggleRef={autoFollowToggleRef}
    />
  );
}
