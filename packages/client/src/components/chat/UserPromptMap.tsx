import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Part, TextPart } from '@prokopai/sdk';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const MIN_PROMPT_MAP_WIDTH = 928;
const MAX_PROMPT_LABEL_LENGTH = 120;
const MAX_PROMPT_PREVIEW_LENGTH = 500;

interface PromptMapSourceItem {
  message: {
    id: string;
    role: string;
    status?: string;
    mode?: string;
    error?: string;
  };
  parts: Part[];
  isQueued?: boolean;
}

export type UserPromptMapItemKind = 'prompt' | 'error' | 'compaction';

export interface UserPromptMapItem {
  kind: UserPromptMapItemKind;
  messageId: string;
  label: string;
  preview: string;
  markerWidth: number;
}

interface UserPromptMapProps {
  displayItems: PromptMapSourceItem[];
  /** Harness-reported boundary (Codex), for sessions without a compaction part. */
  compactedAfterMessageId?: string;
  targetMessageId?: string | null;
  onNavigate: (messageId: string) => void;
}

function isFailedTurn(message: PromptMapSourceItem['message']): boolean {
  return message.role === 'assistant'
    && (message.status === 'error' || message.mode === 'compact_failed' || message.mode === 'retry_failed');
}

function getPromptText(parts: Part[]): string {
  return parts
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => part.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Attachment prompt';
}

function truncatePrompt(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

export function buildUserPromptMapItems(
  displayItems: PromptMapSourceItem[],
  compactedAfterMessageId?: string,
): UserPromptMapItem[] {
  return displayItems.flatMap((item): UserPromptMapItem[] => {
    if (item.isQueued) return [];
    const messageId = item.message.id;

    if (item.message.role === 'user') {
      const promptText = getPromptText(item.parts);
      const label = truncatePrompt(promptText, MAX_PROMPT_LABEL_LENGTH);
      return [{
        kind: 'prompt',
        messageId,
        label,
        preview: truncatePrompt(promptText, MAX_PROMPT_PREVIEW_LENGTH),
        markerWidth: Math.min(28, Math.max(10, 8 + Math.sqrt(label.length) * 2)),
      }];
    }

    if (isFailedTurn(item.message)) {
      const reason = item.message.error?.replace(/\s+/g, ' ').trim();
      return [{
        kind: 'error',
        messageId,
        label: 'Turn failed',
        preview: truncatePrompt(reason ? `Turn failed: ${reason}` : 'Turn failed', MAX_PROMPT_PREVIEW_LENGTH),
        markerWidth: 14,
      }];
    }

    if (messageId === compactedAfterMessageId || item.parts.some(part => part.type === 'compaction')) {
      return [{
        kind: 'compaction',
        messageId,
        label: 'Context compacted',
        preview: 'Context compacted',
        markerWidth: 18,
      }];
    }

    return [];
  });
}

const MARKER_CLASS: Record<UserPromptMapItemKind, { idle: string; active: string }> = {
  prompt: {
    idle: 'h-px rounded-full bg-muted-foreground/45 group-hover:h-0.5 group-hover:bg-foreground',
    active: 'h-0.5 bg-foreground',
  },
  error: {
    idle: 'h-0.5 rounded-full bg-destructive/70 group-hover:bg-destructive',
    active: 'bg-destructive',
  },
  compaction: {
    idle: 'h-0 border-t border-dashed border-muted-foreground/50 group-hover:border-foreground',
    active: 'border-foreground',
  },
};

function markerLabel(item: UserPromptMapItem, promptNumber: number): string {
  if (item.kind === 'prompt') return `Go to prompt ${promptNumber}: ${item.label}`;
  if (item.kind === 'error') return `Go to failed turn: ${item.preview}`;
  return 'Go to context compaction';
}

/** Prompts keep their own 1-based numbering; other markers do not count. */
function buildMarkerLabels(items: UserPromptMapItem[]): string[] {
  const labels: string[] = [];
  let promptNumber = 0;
  for (const item of items) {
    if (item.kind === 'prompt') promptNumber += 1;
    labels.push(markerLabel(item, promptNumber));
  }
  return labels;
}

export function canShowUserPromptMap(width: number): boolean {
  return width >= MIN_PROMPT_MAP_WIDTH;
}

export function UserPromptMap({
  displayItems,
  compactedAfterMessageId,
  targetMessageId,
  onNavigate,
}: UserPromptMapProps) {
  const promptItems = useMemo(
    () => buildUserPromptMapItems(displayItems, compactedAfterMessageId),
    [displayItems, compactedAfterMessageId],
  );
  const markerLabels = useMemo(() => buildMarkerLabels(promptItems), [promptItems]);
  const [hasRoom, setHasRoom] = useState(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const resizeFrameRef = useRef<number | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }

    if (!node) return;

    setHasRoom(canShowUserPromptMap(node.clientWidth));
    observerRef.current = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (!entry) return;
      const nextHasRoom = canShowUserPromptMap(entry.contentRect.width);

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        setHasRoom(previous => previous === nextHasRoom ? previous : nextHasRoom);
      });
    });
    observerRef.current.observe(node);
  }, []);

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  if (promptItems.length === 0) return null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-20">
      {hasRoom && (
        <nav
          aria-label="User prompts"
          className="absolute top-6 right-3 bottom-16 flex w-8 items-center"
        >
          <TooltipProvider>
            <div className="flex max-h-full w-full flex-col gap-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {promptItems.map((item, index) => (
                <Tooltip key={item.messageId}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={markerLabels[index]}
                      onClick={() => onNavigate(item.messageId)}
                      className="group pointer-events-auto flex h-3 w-8 shrink-0 items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span
                        className={cn(
                          'block transition-all',
                          MARKER_CLASS[item.kind].idle,
                          targetMessageId === item.messageId && MARKER_CLASS[item.kind].active,
                        )}
                        style={{ width: `${item.markerWidth}px` }}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="left"
                    sideOffset={8}
                    className="block max-h-48 w-80 max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden whitespace-normal text-left leading-relaxed"
                  >
                    {item.preview}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </TooltipProvider>
        </nav>
      )}
    </div>
  );
}
