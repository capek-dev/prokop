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
  };
  parts: Part[];
  isQueued?: boolean;
}

export interface UserPromptMapItem {
  messageId: string;
  label: string;
  preview: string;
  markerWidth: number;
}

interface UserPromptMapProps {
  displayItems: PromptMapSourceItem[];
  targetMessageId?: string | null;
  onNavigate: (messageId: string) => void;
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
): UserPromptMapItem[] {
  return displayItems.flatMap((item) => {
    if (item.message.role !== 'user' || item.isQueued) return [];

    const promptText = getPromptText(item.parts);
    const label = truncatePrompt(promptText, MAX_PROMPT_LABEL_LENGTH);
    return [{
      messageId: item.message.id,
      label,
      preview: truncatePrompt(promptText, MAX_PROMPT_PREVIEW_LENGTH),
      markerWidth: Math.min(28, Math.max(10, 8 + Math.sqrt(label.length) * 2)),
    }];
  });
}

export function canShowUserPromptMap(width: number): boolean {
  return width >= MIN_PROMPT_MAP_WIDTH;
}

export function UserPromptMap({
  displayItems,
  targetMessageId,
  onNavigate,
}: UserPromptMapProps) {
  const promptItems = useMemo(
    () => buildUserPromptMapItems(displayItems),
    [displayItems],
  );
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
          <TooltipProvider delayDuration={250}>
            <div className="flex max-h-full w-full flex-col gap-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {promptItems.map((item, index) => (
                <Tooltip key={item.messageId}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Go to prompt ${index + 1}: ${item.label}`}
                      onClick={() => onNavigate(item.messageId)}
                      className="group pointer-events-auto flex h-3 w-8 shrink-0 cursor-pointer items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span
                        className={cn(
                          'block h-px rounded-full bg-muted-foreground/45 transition-all group-hover:h-0.5 group-hover:bg-foreground',
                          targetMessageId === item.messageId && 'h-0.5 bg-foreground',
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
