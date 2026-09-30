import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Archive, Minimize2, Loader2, AlertTriangle } from 'lucide-react';
import type { Session, Preconfig, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenMeter } from './TokenMeter';
import { ModelVariantConfigSelector } from './ModelVariantConfigSelector';
import { useSessionStore } from '@/stores/sessionStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { SessionUsage } from '@/stores/sessionStore';

import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import {useIsCompact, useIsMobile} from '@/hooks/use-mobile';

interface Model {
  id: string;
  name: string;
  contextWindow: number;
  tier: 'budget' | 'standard' | 'premium';
  providerId: string;
  providerName: string;
}

interface ChatHeaderProps {
  session: Session;
  sdkClient?: ProkopaiClient | null;
  serverUrl?: string | null;
  preconfigs: Preconfig[];
  models: Model[];
  defaultModel: string;
  usage: SessionUsage;  modelName: string;
  onChangePreconfig: (preconfigId: string) => void;
  onChangeModel: (modelId: string, providerId: string) => void;
  onChangeVariant: (variant: string | null) => void;
  onRename: (sessionId: string, title: string) => void;
  onNavigateBack?: () => void;
  isStreaming?: boolean;
  onCompact?: () => void;
  isCompacting?: boolean;
  canCompact?: boolean;
  selectedVariant: string | null;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  /** When true, locks the preconfig selector (e.g. agent-home workspaces). */
  lockPreconfig?: boolean;
}

export function ChatHeader({
  session,
  sdkClient = null,
  serverUrl = null,
  preconfigs,
  models,
  modelName,
  onChangePreconfig,
  onChangeModel,
  onChangeVariant,
  onRename,
  onNavigateBack,
  isStreaming,
  onCompact,
  isCompacting,
  canCompact,
  selectedVariant,
  variants,
  lockPreconfig,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const contentMeta = useSessionStore(s => s.contentMetaBySession[session.id]);
  const messages = useSessionStore(s => s.messagesBySession[session.id]);
  const queued = useSessionStore(s => s.queuedMessages[session.id]);
  const workspace = useServerDataStore(s => s.workspaces.find(w => w.id === session.workspaceId));
  const emptyRoot = !session.parentId && session.status === 'active' && !session.runningAt
    && !isStreaming && contentMeta?.status === 'ready' && !contentMeta.hasOlder
    && messages?.length === 0 && !queued?.length;
  const codexSession = session.harness === 'codex-cli';
  const claudeSession = session.harness === 'claude-cli';
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog', serverUrl],
    queryFn: () => sdkClient!.http.sessions.claudeCatalog(),
    enabled: !!sdkClient && !!serverUrl && emptyRoot && !claudeSession
      && !!workspace && !workspace.isVirtual && !!workspace.path,
    staleTime: 60_000,
    retry: false,
  });
  const claudeKey = ['claude-models', serverUrl, session.id, session.updatedAt];
  const claudeSelection = useQuery({
    queryKey: claudeKey,
    queryFn: () => sdkClient!.http.sessions.claudeModels(session.id),
    enabled: !!sdkClient && !!serverUrl && claudeSession,
    staleTime: 60_000,
    retry: false,
  });
  const claudeModels = claudeSession ? claudeSelection.data?.models ?? []
    : emptyRoot && workspace && !workspace.isVirtual ? claudeCatalog.data?.models ?? [] : [];
  const claudeModel = claudeSelection.data?.selection?.model ?? session.selectedModel;
  const claudeEffort = claudeSelection.data?.selection?.effort ?? null;
  const selectClaude = async (modelId: string, effort: string) => {
    if (!sdkClient || isObserver || isStreaming) return;
    if (!claudeSession) {
      sdkClient.sessions.selectHarnessModel(session.id, { harness: 'claude-cli', modelId, effort });
      return;
    }
    try {
      const response = await sdkClient.http.sessions.setClaudeModel(session.id, { model: modelId, effort });
      queryClient.setQueryData(claudeKey, (old: typeof claudeSelection.data) => old && { ...old, selection: response.selection });
    } catch {
      toast.error('Could not change the Claude model or effort. Check the host and try again.');
    }
  };
  const catalog = useQuery({
    queryKey: ['codex-catalog', serverUrl],
    queryFn: () => sdkClient!.http.sessions.codexCatalog(),
    enabled: !!sdkClient && !!serverUrl && emptyRoot && !codexSession
      && !!workspace && !workspace.isVirtual && !!workspace.path,
    staleTime: 60_000,
    retry: false,
  });
  const codexKey = ['codex-models', serverUrl, session.id, session.updatedAt];
  const codexSelection = useQuery({
    queryKey: codexKey,
    queryFn: () => sdkClient!.http.sessions.codexModels(session.id),
    enabled: !!sdkClient && !!serverUrl && codexSession,
    staleTime: 60_000,
    retry: false,
  });
  const codexModels = codexSession ? codexSelection.data?.models ?? []
    : emptyRoot && workspace && !workspace.isVirtual ? catalog.data?.models ?? [] : [];
  const codexModel = codexSelection.data?.selection?.model ?? session.selectedModel;
  const codexEffort = codexSelection.data?.selection?.effort ?? null;
  const selectCodex = async (modelId: string, effort: string) => {
    if (!sdkClient || isObserver || isStreaming) return;
    if (!codexSession) {
      sdkClient.sessions.selectHarnessModel(session.id, { harness: 'codex-cli', modelId, effort });
      return;
    }
    try {
      const response = await sdkClient.http.sessions.setCodexModel(session.id, { model: modelId, effort });
      queryClient.setQueryData(codexKey, (old: typeof codexSelection.data) => old && { ...old, selection: response.selection });
    } catch {
      toast.error('Could not change the Codex model or effort. Check the host and try again.');
    }
  };
  const selectProkop = (modelId: string, providerId: string) => {
    if (codexSession || claudeSession) sdkClient?.sessions.selectHarnessModel(session.id, { harness: 'prokop', modelId, providerId });
    else onChangeModel(modelId, providerId);
  };
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();
  const hasMultipleOpenSessions = useSessionBoardStore((s) => s.openSessionIds.length > 1);
  const showFullModelSelector = isMobile || hasMultipleOpenSessions;

  const controlState = useSessionControlStore((s) => s.controlBySessionId[session.id]);
  const myClientId = useClientIdentityStore((s) => s.clientId);

  const isObserver = controlState?.status === 'controlled' && controlState.controllerClientId !== myClientId;
  const compactPending = usePendingOperationsStore(s => s.operations.some(op =>
    op.sessionId === session.id && op.type === 'compact'));
  const compactUncertain = claudeSession && session.metadata?.claudeCompactPending === true
    && !compactPending && !isCompacting;
  const compactBusy = isCompacting || compactPending
    || (codexSession && session.metadata?.codexCompactPending === true);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleTitleDoubleClick = () => {
    setEditTitle(session.title || '');
    setIsEditing(true);
  };

  const handleTitleSubmit = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSubmit();
    } else if (e.key === 'Escape') {
      setEditTitle(session.title || '');
      setIsEditing(false);
    }
  };

  const selectedModel = session.selectedModel ||
    preconfigs.find((p) => p.id === session.preconfigId)?.model ||
    modelName;

  return (
    <div className="flex-1 min-w-0 flex items-center justify-between gap-1">
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center justify-between gap-1 w-full min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {session.parentId && onNavigateBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigateBack}
                className="h-7"
              >
                <ArrowLeft className="size-4" data-icon="inline-start" />
                Back
              </Button>
            )}

            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSubmit}
                onKeyDown={handleKeyDown}
                className="text-base font-semibold leading-none bg-background border border-primary rounded px-2 py-1.5 outline-none min-w-0 flex-1"
                autoFocus
              />
            ) : (
              <h2
                className="text-base font-semibold leading-none cursor-pointer px-2 py-1.5 -mx-2 rounded hover:bg-accent transition-colors truncate min-w-0"
                onDoubleClick={handleTitleDoubleClick}
              >
                {session.title || 'Untitled Session'}
              </h2>
            )}

            <TokenMeter usage={session.harnessState?.usage ?? null} />
            {session.status === 'closed' && (
              <Badge variant="secondary">
                <Archive className="size-3" data-icon="inline-start" />
                Archived
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap md:flex-nowrap shrink-0">
            <ModelVariantConfigSelector
              models={(codexSession || claudeSession) && !emptyRoot ? [] : models}
              claudeModels={claudeModels}
              claudeSession={claudeSession}
              claudeSelectedModel={claudeModel}
              claudeEffort={claudeEffort}
              onChangeClaude={(modelId, effort) => void selectClaude(modelId, effort)}
              codexModels={codexModels}
              codexSession={codexSession}
              codexSelectedModel={codexModel}
              codexEffort={codexEffort}
              onChangeCodex={(modelId, effort) => void selectCodex(modelId, effort)}
              selectedModelId={selectedModel}
              selectedProviderId={session.selectedProvider}
              fallbackModelName={modelName}
              onChangeModel={selectProkop}
              variants={variants}
              selectedVariant={selectedVariant}
              onChangeVariant={onChangeVariant}
              preconfigs={preconfigs}
              selectedPreconfigId={session.preconfigId}
              onChangePreconfig={onChangePreconfig}
              disabled={session.status === 'closed' || !!session.parentId || isObserver || ((codexSession || claudeSession) && !!isStreaming)}
              lockPreconfig={lockPreconfig}
              iconOnly={showFullModelSelector}
              compact={isCompact}
            />

            {onCompact && !isObserver && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onCompact}
                    disabled={isStreaming || compactBusy || compactUncertain || !canCompact}
                    aria-label={compactUncertain ? 'Compaction outcome unknown' : 'Compact older messages'}
                  >
                    {compactUncertain ? <AlertTriangle className="size-4 text-warning" />
                      : compactBusy ? <Loader2 className="size-4 animate-spin" />
                        : <Minimize2 className="size-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {compactUncertain ? 'Compaction outcome unknown. This session is locked to avoid replay.'
                    : compactBusy ? 'Compacting...' : 'Compact older messages'}
                </TooltipContent>
              </Tooltip>
            )}

          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
