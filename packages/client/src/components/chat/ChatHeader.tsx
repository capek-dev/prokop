import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Archive, Minimize2, Loader2 } from 'lucide-react';
import type { Session, Preconfig } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { TokenMeter } from './TokenMeter';
import { ModelVariantConfigSelector } from './ModelVariantConfigSelector';
import { SessionControlButton } from './SessionControlButton';
import { useSessionControlStore } from '@/stores/sessionControlStore';
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
  preconfigs: Preconfig[];
  models: Model[];
  defaultModel: string;
  usage: SessionUsage;
  modelName: string;
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
  onClaimControl?: (sessionId: string) => void;
  /** When true, locks the preconfig selector (e.g. agent-home workspaces). */
  lockPreconfig?: boolean;
}

type ControlUiState =
  | 'uncontrolled'
  | 'controller'
  | 'observer';

function deriveControlUiState(
  controlStatus: string | undefined,
  isController: boolean,
): ControlUiState {
  if (!controlStatus || controlStatus === 'uncontrolled') return 'uncontrolled';
  if (controlStatus === 'controlled') {
    return isController ? 'controller' : 'observer';
  }
  return 'uncontrolled';
}

export function ChatHeader({
  session,
  preconfigs,
  models,
  usage,
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
  onClaimControl,
  lockPreconfig,
}: ChatHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const isCompact = useIsCompact();

  const controlState = useSessionControlStore((s) => s.controlBySessionId[session.id]);
  const myClientId = useClientIdentityStore((s) => s.clientId);

  const isActiveControlled = controlState?.status === 'controlled';
  const isController = isActiveControlled && controlState.controllerClientId === myClientId;
  const isObserver = isActiveControlled && controlState.controllerClientId !== myClientId;

  const controlUiState = deriveControlUiState(controlState?.status, isController);

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
  const contextWindow = currentModelInfo?.contextWindow;

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

            <TokenMeter
              promptTokens={usage.promptTokens}
              completionTokens={usage.completionTokens}
              totalTokens={usage.totalTokens}
              cacheReadTokens={usage.cacheReadTokens}
              cacheWriteTokens={usage.cacheWriteTokens}
              noCacheTokens={usage.noCacheTokens}
              contextWindow={contextWindow}
              modelName={modelName}
              compact={isMobile}
            />

            {session.status === 'closed' && (
              <Badge variant="secondary">
                <Archive className="size-3" data-icon="inline-start" />
                Archived
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1 flex-wrap md:flex-nowrap shrink-0">
            <ModelVariantConfigSelector
              models={models}
              selectedModelId={selectedModel}
              selectedProviderId={session.selectedProvider}
              fallbackModelName={modelName}
              onChangeModel={onChangeModel}
              variants={variants}
              selectedVariant={selectedVariant}
              onChangeVariant={onChangeVariant}
              preconfigs={preconfigs}
              selectedPreconfigId={session.preconfigId}
              onChangePreconfig={onChangePreconfig}
              disabled={session.status === 'closed' || !!session.parentId || isObserver}
              lockPreconfig={lockPreconfig}
              iconOnly={isMobile}
              compact={isCompact}
            />

            {myClientId && (
              <SessionControlButton
                uiState={controlUiState}
                sessionId={session.id}
                onClaimControl={onClaimControl}
              />
            )}

            {onCompact && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onCompact}
                    disabled={isStreaming || isCompacting || !canCompact}
                  >
                    {isCompacting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Minimize2 className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isCompacting ? 'Compacting...' : 'Compact older messages'}
                </TooltipContent>
              </Tooltip>
            )}

          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
