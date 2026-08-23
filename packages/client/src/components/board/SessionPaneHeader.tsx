import { useMemo } from 'react';
import { GripVertical, X } from 'lucide-react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { Session, Preconfig, Workspace } from '@prokopai/sdk';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSessionCommands } from '@/contexts/SessionCommandsContext';
import { getWorkspacePreconfigs } from '@/lib/workspacePreconfigs';
import { useServerDataStore } from '@/stores/serverDataStore';

interface Model {
  id: string;
  name: string;
  contextWindow: number;
  tier: 'budget' | 'standard' | 'premium';
  providerId: string;
  providerName: string;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
}

export interface SessionPaneHeaderProps {
  sessionId: string;
  onRemove: () => void;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  setDragActivatorNode?: (element: HTMLButtonElement | null) => void;
}

/**
 * Per-pane session header for the multi-session board.
 * Wraps ChatHeader and binds every callback to the pane's sessionId.
 * All state is resolved per-session from keyed stores, never from singletons.
 *
 * Workspace-specific data (preconfigs and lockPreconfig) is resolved
 * from the session's own workspaceId, not the global activeWorkspace.
 */
export function SessionPaneHeader({
  sessionId,
  onRemove,
  dragAttributes,
  dragListeners,
  setDragActivatorNode,
}: SessionPaneHeaderProps) {
  const commands = useSessionCommands();

  const session = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId) as Session | undefined);
  const sessionUsage = useSessionStore(s => s.usageBySessionId[sessionId]);
  const currentModel = useSessionStore(s => s.modelBySessionId[sessionId]);
  const selectedVariant = useSessionStore(s => s.variantBySessionId[sessionId]);
  const sessionMessages = useSessionStore(s => s.messagesBySession[sessionId]);
  const isStreaming = useConnectionStore(s => s.streamingSessionIds.has(sessionId));
  const allPreconfigs = useServerDataStore(s => s.preconfigs);
  const models = useServerDataStore(s => s.models) as Model[];
  const defaultModel = useServerDataStore(s => s.defaultModel);
  const allWorkspaces = useServerDataStore(s => s.workspaces);

  // Resolve the workspace from the session's own workspaceId.
  // This ensures each pane shows its correct workspace preconfigs and label,
  // even for non-focused panes in a mixed-workspace board.
  const sessionWorkspace: Workspace | null = useMemo(() => {
    if (!session?.workspaceId) return null;
    return allWorkspaces.find(w => w.id === session.workspaceId) ?? null;
  }, [session?.workspaceId, allWorkspaces]);

  const preconfigs = useMemo(
    () => getWorkspacePreconfigs(sessionWorkspace, allPreconfigs) as Preconfig[],
    [sessionWorkspace, allPreconfigs],
  );

  const lockPreconfig = !!sessionWorkspace?.settings?.isAgentHome;

  if (!session) return null;

  const headerStreaming = isStreaming || !!session.runningAt;

  const usage = sessionUsage ?? {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    noCacheTokens: 0,
  };
  const currentModelInfo = models.find(m => m.id === currentModel);
  const compactableMessageCount = (sessionMessages ?? []).filter(m => m.role !== 'system').length;
  const isCompacting = session.compacting ?? false;

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-muted/30 shrink-0">
      {dragAttributes && (
        <Button
          ref={setDragActivatorNode}
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 cursor-grab touch-none active:cursor-grabbing"
          onMouseDown={(event) => event.stopPropagation()}
          title={`Reorder ${session.title || 'session'}`}
          aria-label={`Reorder ${session.title || 'session'}`}
          {...dragAttributes}
          {...dragListeners}
        >
          <GripVertical className="size-3.5" />
        </Button>
      )}
      <ChatHeader
        session={session}
        preconfigs={preconfigs}
        models={models}
        defaultModel={defaultModel}
        usage={usage}
        modelName={currentModel}
        onChangePreconfig={(preconfigId) => commands.updateSessionPreconfigForSession(sessionId, preconfigId)}
        onChangeModel={(modelId, providerId) => commands.updateSessionModelForSession(sessionId, modelId, providerId)}
        onChangeVariant={(variant) => commands.updateSessionVariantForSession(sessionId, variant)}
        onRename={commands.handleRenameSession}
        onNavigateBack={
          session.parentId
            ? () => commands.resumeSession(session.parentId!)
            : undefined
        }
        isStreaming={headerStreaming}
        onCompact={compactableMessageCount >= 2 ? () => commands.compactSession(sessionId) : undefined}
        isCompacting={isCompacting}
        canCompact={compactableMessageCount >= 2}
        selectedVariant={selectedVariant ?? null}
        variants={currentModelInfo?.variants}
        onClaimControl={commands.claimControl}
        lockPreconfig={lockPreconfig}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-6 shrink-0"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="Remove from board"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
