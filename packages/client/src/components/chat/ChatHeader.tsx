import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHarnessesQuery, isHarnessEnabled } from '@/hooks/queries';
import { toast } from 'sonner';
import { ArrowLeft, Archive, ChevronRight, Minimize2, Loader2, AlertTriangle } from 'lucide-react';
import type { Session, Preconfig, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenMeter } from './TokenMeter';
import { ModelVariantConfigSelector } from './ModelVariantConfigSelector';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionControlStore } from '@/stores/sessionControlStore';
import { usePendingOperationsStore } from '@/stores/pendingOperationsStore';
import type { SessionUsage } from '@/stores/sessionStore';

import { useClientIdentityStore } from '@/stores/clientIdentityStore';
import {useIsCompact, useIsMobile} from '@/hooks/use-mobile';
import { useElementWidth } from '@/hooks/use-element-width';
import { useScopedServerData } from '@/contexts/HostScopeContext';

// Header widths (px) below which the model selector collapses.
const ICON_ONLY_SELECTOR_MAX_WIDTH = 420;
const COMPACT_SELECTOR_MAX_WIDTH = 640;

interface Model {
  id: string;
  name: string;
  contextWindow: number;
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
  /** Shown before the title where sessions from several workspaces mix (Overview). */
  workspaceLabel?: string | null;
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
  workspaceLabel,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const contentMeta = useSessionStore(s => s.contentMetaBySession[session.id]);
  const messages = useSessionStore(s => s.messagesBySession[session.id]);
  const queued = useSessionStore(s => s.queuedMessages[session.id]);
  const workspace = useScopedServerData(s => s.workspaces.find(w => w.id === session.workspaceId));
  const emptyRoot = !session.parentId && session.status === 'active' && !session.runningAt
    && !isStreaming && contentMeta?.status === 'ready' && !contentMeta.hasOlder
    && messages?.length === 0 && !queued?.length;
  const codexSession = session.harness === 'codex-cli';
  const claudeSession = session.harness === 'claude-cli';
  const harnessesData = useHarnessesQuery(sdkClient).data;
  const harnessEnabled = (id: 'codex-cli' | 'claude-cli') =>
    isHarnessEnabled(harnessesData?.harnesses.find(h => h.id === id));
  const claudeHarnessEnabled = harnessEnabled('claude-cli');
  const codexHarnessEnabled = harnessEnabled('codex-cli');
  const claudeCatalog = useQuery({
    queryKey: ['claude-catalog', serverUrl],
    queryFn: () => sdkClient!.http.sessions.claudeCatalog(),
    enabled: !!sdkClient && !!serverUrl && emptyRoot && !claudeSession && claudeHarnessEnabled
      && !!workspace && !workspace.isVirtual && !!workspace.path,
    staleTime: 60_000,
    retry: false,
  });
  const claudeKey = ['claude-models', serverUrl, session.id, session.selectedModel];
  const claudeSelection = useQuery({
    queryKey: claudeKey,
    queryFn: () => sdkClient!.http.sessions.claudeModels(session.id),
    enabled: !!sdkClient && !!serverUrl && claudeSession,
    staleTime: 60_000,
    retry: false,
  });
  const claudeModels = claudeSession ? claudeSelection.data?.models ?? []
    : emptyRoot && workspace && !workspace.isVirtual && claudeHarnessEnabled ? claudeCatalog.data?.models ?? [] : [];
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
    enabled: !!sdkClient && !!serverUrl && emptyRoot && !codexSession && codexHarnessEnabled
      && !!workspace && !workspace.isVirtual && !!workspace.path,
    staleTime: 60_000,
    retry: false,
  });
  const codexKey = ['codex-models', serverUrl, session.id, session.selectedModel];
  const codexSelection = useQuery({
    queryKey: codexKey,
    queryFn: () => sdkClient!.http.sessions.codexModels(session.id),
    enabled: !!sdkClient && !!serverUrl && codexSession,
    staleTime: 60_000,
    retry: false,
  });
  const codexModels = codexSession ? codexSelection.data?.models ?? []
    : emptyRoot && workspace && !workspace.isVirtual && codexHarnessEnabled ? catalog.data?.models ?? [] : [];
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
  // Size the selector from this header's own width, so split panes only
  // shrink it when the pane is actually narrow.
  const [headerRef, headerWidth] = useElementWidth<HTMLDivElement>();
  const showIconOnlySelector = isMobile || (headerWidth !== null && headerWidth < ICON_ONLY_SELECTOR_MAX_WIDTH);
  const showCompactSelector = isCompact || (headerWidth !== null && headerWidth < COMPACT_SELECTOR_MAX_WIDTH);

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

  const currentModelInfo = session.selectedProvider
    ? models.find((m) => m.providerId === session.selectedProvider && m.id === selectedModel)
    : models.find((m) => m.id === selectedModel);
  const modelContextWindow = currentModelInfo?.contextWindow ?? 0;
  // Prokop sessions carry no server-side context window (the server does not
  // know model limits); fill the meter denominator from the model catalog so
  // the ring keeps its percentage. Codex and Claude report theirs.
  const reportedUsage = session.harnessState?.usage ?? null;
  const meterUsage = reportedUsage
    ? {
      ...reportedUsage,
      contextWindow: reportedUsage.contextWindow > 0 ? reportedUsage.contextWindow : modelContextWindow,
    }
    : null;

  return (
    <div ref={headerRef} className="flex-1 min-w-0 flex items-center justify-between gap-1">
      <TooltipProvider>
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

            {workspaceLabel && !isEditing && (
              <span className="flex min-w-0 shrink items-center gap-1 text-sm text-muted-foreground" title={`Workspace: ${workspaceLabel}`}>
                <span className="max-w-[10rem] truncate">{workspaceLabel}</span>
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground/60" />
              </span>
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
                className="text-base font-semibold leading-none px-2 py-1.5 -mx-2 rounded hover:bg-accent transition-colors truncate min-w-0"
                onDoubleClick={handleTitleDoubleClick}
              >
                {session.title || 'Untitled Session'}
              </h2>
            )}

            <TokenMeter usage={meterUsage} />
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
              iconOnly={showIconOnlySelector}
              compact={showCompactSelector}
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
