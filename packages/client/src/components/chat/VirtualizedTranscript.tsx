import { useRef, useEffect, useState, useCallback, useMemo, memo, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { buildApiUrl } from '@/config/urls';
import { LegendList, type LegendListRef } from '@legendapp/list/react';
import { ChevronDown, ChevronRight, Download, FileIcon, Braces, Loader2 } from 'lucide-react';
import type {
  MessageWithParts,
  Part,
  TextPart,
  Message,
  CompactionPart,
  AssistantMessage,
  AskResponse,
  StructuredOutputData,
} from '@prokopai/sdk';
import { isAssistantMessage } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Minimize2, RotateCcw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MessageBubble } from './MessageBubble';
import { ErrorMessageContent } from './ErrorMessageContent';
import { ToolCall } from './ToolCall';
import { cn } from '@/lib/utils';
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer';
import { StructuredResponse } from '@/components/visualizations';
import type { PendingAskRequest } from '@/stores/askStore';
import { splitStreamingText } from './streamingText';

const USER_SCROLL_INPUT_WINDOW_MS = 200;

export interface DisplayItem {
  message: Message;
  parts: Part[];
  isQueued?: boolean;
  queueId?: string;
}

interface VirtualizedTranscriptProps {
  displayItems: DisplayItem[];
  messagesWithParts: MessageWithParts[];
  sessionId: string;
  sessionStatus?: string;
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent?: (sessionId: string) => void;
  onRemoveFromQueue?: (queueId: string) => void;
  onRevert?: (sessionId: string, stepPartId: string) => void;
  onFork?: (sessionId: string, messageId: string) => void;
  onEditMessage?: (sessionId: string, messageId: string, content: string) => void;
  onCompact?: () => void;
  isMainActiveSession?: boolean;
  isCompacting?: boolean;
  compactionSuccess?: boolean;
  onClearCompactionSuccess?: () => void;
  autoFollow?: boolean;
  onAutoScrollChange?: (enabled: boolean) => void;
  scrollToBottomRef?: React.RefObject<(() => void) | null>;
  serverUrl?: string;
  pinnedMessageIds?: Set<string>;
  onTogglePinMessage?: (message: Message) => void;
  isPinningMessage?: boolean;
  targetMessageId?: string | null;
  onTargetMessageHandled?: () => void;
  hasOlder?: boolean;
  isLoadingOlder?: boolean;
  loadOlderError?: string | null;
  onLoadOlder?: () => void;
  emptyContent?: ReactNode;
}

function getTextContent(parts: Part[]): string {
  return parts
    .filter((part): part is TextPart => part.type === 'text')
    .map(part => part.text)
    .join('');
}

/**
 * Double single newlines for markdown line breaks in user messages,
 * but preserve original formatting inside fenced code blocks.
 */
function formatInvertedText(text: string): string {
  const segments = text.split(/```/);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) {
        // Inside a fenced code block — preserve as-is, re-add fences
        return '```' + segment + '```';
      }
      // Outside code blocks — double single newlines for markdown rendering
      return segment.replace(/\n(?!\n)/g, '\n\n');
    })
    .join('');
}

function CompactionInProgressBanner() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-foreground bg-muted rounded-lg px-3 py-2 border border-border shadow-sm">
      <Minimize2 className="size-4 animate-pulse" />
      <span>Compacting conversation...</span>
    </div>
  );
}

function CompactionSuccessBanner() {
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-green-700 dark:text-green-400 bg-green-500/15 rounded-lg px-3 py-2 border border-green-500/30 shadow-sm">
      <CheckCircle2 className="size-4" />
      <span>Compaction complete</span>
    </div>
  );
}

function CompactionFailedMessage({
  message,
  textContent,
  onRetry,
}: {
  message: AssistantMessage;
  textContent: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-destructive ml-3">
        <AlertTriangle className="size-3" />
        Compaction Failed
      </div>
      <div className="rounded-2xl px-4 py-3 max-w-full bg-destructive/10 border border-destructive/30 rounded-bl-md">
        <p className="text-sm text-destructive/90">
          {textContent || message.error || 'Compaction failed. The conversation could not be summarized.'}
        </p>
        {onRetry && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="mt-2 h-7 text-xs gap-1.5"
          >
            <RotateCcw className="size-3" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function getFileExtensionBadge(mimeType?: string, filename?: string): string {
  const ext = mimeType?.split('/').pop() || filename?.split('.').pop()?.toLowerCase() || '';
  return ext;
}

function CompactionDivider({ part }: { part: CompactionPart }) {
  const [expanded, setExpanded] = useState(false);

  const reason = part.overflow ? 'overflow' : part.auto ? 'auto' : 'manual';

  return (
    <div className="flex flex-col items-center py-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="border-b border-dashed border-muted-foreground/40 pb-px">
          {reason === 'overflow' ? 'Context overflow' : reason === 'auto' ? 'Auto' : 'Manual'} compaction
        </span>
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-muted-foreground italic">
          Summary available in the assistant message below
        </div>
      )}
    </div>
  );
}

// Parts that have streamed in this app session keep the streaming render path
// after completion, so the finished message never remounts into a different
// tree (which would pop the already-visible text).
const STREAMED_PART_IDS = new Set<string>();

const MIN_REVEAL_CPS = 12;
const ACTIVE_CATCHUP_S = 0.45;
const DONE_CATCHUP_S = 0.25;

const StreamBlock = memo(function StreamBlock({ block }: { block: string }) {
  return <MarkdownRenderer>{block}</MarkdownRenderer>;
});

/**
 * Reveals `text` at a steady character rate via rAF instead of jumping per
 * network flush. Mounts snapped to the current text (no replay); afterwards
 * new arrivals drain within a small catch-up window so the visible text never
 * lags far behind. Same renderer for tail and blocks, so a block graduating
 * from tail to stable is pixel-identical (no typography pop).
 */
function useRevealedLength(text: string, active: boolean): number {
  const [revealed, setRevealed] = useState(() => text.length);
  const revealedRef = useRef(revealed);
  const targetRef = useRef(text.length);
  const activeRef = useRef(active);

  useEffect(() => {
    targetRef.current = text.length;
    activeRef.current = active;

    if (targetRef.current < revealedRef.current) {
      // Text replaced wholesale (edit/revert): snap to it.
      revealedRef.current = targetRef.current;
      setRevealed(targetRef.current);
      return;
    }
    if (targetRef.current === revealedRef.current) return;

    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      const backlog = targetRef.current - revealedRef.current;
      if (backlog <= 0) return;
      const catchUpS = activeRef.current ? ACTIVE_CATCHUP_S : DONE_CATCHUP_S;
      const rate = Math.max(MIN_REVEAL_CPS, backlog / catchUpS);
      const next = Math.min(
        targetRef.current,
        revealedRef.current + Math.max(1, Math.round(rate * dt)),
      );
      revealedRef.current = next;
      setRevealed(next);
      if (next < targetRef.current) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [text, active]);

  return Math.min(revealed, text.length);
}

function StreamingText({ text, active }: { text: string; active: boolean }) {
  const revealed = useRevealedLength(text, active);
  // Frozen first-render flag: a fresh mount of already-complete text skips the
  // block split and renders once (identical visuals, single parse).
  const [mountedInactive] = useState(!active);

  if (!active && mountedInactive && revealed >= text.length) {
    return <MarkdownRenderer>{text}</MarkdownRenderer>;
  }

  const visible = text.slice(0, revealed);
  const { blocks, tail } = splitStreamingText(visible);

  return (
    <div className="min-w-0">
      {blocks.map((block, index) => (
        <StreamBlock key={`${index}:${block.length}`} block={block} />
      ))}
      {tail && <MarkdownRenderer>{tail}</MarkdownRenderer>}
    </div>
  );
}

/**
 * Reasoning streams through the same reveal cadence as text. It renders as a
 * plain text node (no markdown), so the reveal is the only thing needed to
 * avoid word-chunk jumps between 75ms store flushes.
 */
function StreamingReasoning({ text, active }: { text: string; active: boolean }) {
  const revealed = useRevealedLength(text, active);
  return <>{text.slice(0, revealed)}</>;
}

const MessageParts = memo(function MessageParts({
  sessionId,
  parts,
  pendingAskRequests,
  onAskResponse,
  onNavigateToSubagent,
  inverted = false,
  isStreaming = false,
  serverUrl,
}: {
  sessionId: string;
  parts: Part[];
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent?: (sessionId: string) => void;
  inverted?: boolean;
  isStreaming?: boolean;
  serverUrl?: string;
}) {
  return (
    <>
      {parts.map((part) => {
        switch (part.type) {
          case 'text': {
            const text = inverted && part.text
              ? formatInvertedText(part.text)
              : (part.text || '...');
            if (isStreaming && !inverted) STREAMED_PART_IDS.add(part.id);
            const streamingPath = !inverted && (isStreaming || STREAMED_PART_IDS.has(part.id));
            return (
              <div key={part.id} className="min-w-0">
                {streamingPath ? (
                  <StreamingText text={text} active={isStreaming} />
                ) : (
                  <MarkdownRenderer inverted={inverted}>{text}</MarkdownRenderer>
                )}
              </div>
            );
          }

          case 'reasoning':
            return (
              <div
                key={part.id}
                className="visualization-container text-muted-foreground text-sm italic border-l-2 border-muted-foreground/30 pl-3 my-2 wrap-break-word"
              >
                <StreamingReasoning text={part.text} active={isStreaming} />
              </div>
            );

          case 'tool':
            return (
              <ToolCall
                key={part.id}
                sessionId={sessionId}
                part={part}
                pendingAskRequests={pendingAskRequests}
                onAskResponse={onAskResponse}
                onNavigateToSubagent={onNavigateToSubagent}
              />
            );

          case 'image': {
            const fullUrl = serverUrl ? buildApiUrl(serverUrl, part.url) : part.url;
            return (
              <img
                key={part.id}
                src={fullUrl}
                alt=""
                className={cn(
                  'max-w-full max-h-64 rounded-xl mt-2 object-contain',
                  inverted && 'ring-2 ring-white/20'
                )}
              />
            );
          }

          case 'file': {
            const fullUrl = serverUrl ? buildApiUrl(serverUrl, part.url) : part.url;
            const ext = getFileExtensionBadge(part.mimeType, part.filename);
            const filename = part.filename || '';
            const displayName = filename.length > 30
              ? filename.slice(0, 27) + '...'
              : (filename || 'unnamed');
            return (
              <a
                key={part.id}
                href={fullUrl}
                className={cn(
                  'mt-2 p-2 rounded-lg text-sm flex items-center gap-2 transition-colors',
                  inverted
                    ? 'bg-white/15 hover:bg-white/25 text-primary-foreground'
                    : 'bg-muted hover:bg-accent'
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileIcon className="size-4 shrink-0" />
                <span className="truncate">{displayName}</span>
                {ext && (
                  <span className={cn(
                    'px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ml-auto shrink-0',
                    inverted
                      ? 'bg-white/25 text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground'
                  )}>
                    {ext}
                  </span>
                )}
                <Download className="size-3.5 shrink-0 opacity-60" />
              </a>
            );
          }

          default:
            return null;
        }
      })}
    </>
  );
}, (prev, next) => {
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.parts !== next.parts) return false;
  if (prev.inverted !== next.inverted) return false;
  if (prev.isStreaming !== next.isStreaming) return false;
  if (prev.onNavigateToSubagent !== next.onNavigateToSubagent) return false;
  if (prev.serverUrl !== next.serverUrl) return false;

  return prev.pendingAskRequests === next.pendingAskRequests;


});

const StructuredOutputMessage = memo(function StructuredOutputMessage({
  sessionId,
  parts,
  structuredOutput,
  pendingAskRequests,
  onAskResponse,
  onNavigateToSubagent,
  serverUrl,
}: {
  sessionId: string;
  parts: Part[];
  structuredOutput: StructuredOutputData;
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent?: (sessionId: string) => void;
  serverUrl?: string;
}) {
  const [rawOpen, setRawOpen] = useState(false);

  return (
    <>
      <Collapsible open={rawOpen} onOpenChange={setRawOpen}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 py-1 cursor-pointer hover:text-foreground transition-colors text-muted-foreground">
            <Braces className="size-3 text-primary" />
            {rawOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <span className="text-xs">
              Raw Output
              {structuredOutput.formatName && (
                <span className="text-muted-foreground"> · {structuredOutput.formatName}</span>
              )}
            </span>
          </div>
        </CollapsibleTrigger>
        {rawOpen && (
          <CollapsibleContent>
            <div className="pb-2">
              <MessageParts
                sessionId={sessionId}
                parts={parts}
                pendingAskRequests={pendingAskRequests}
                onAskResponse={onAskResponse}
                onNavigateToSubagent={onNavigateToSubagent}
                inverted={false}
                serverUrl={serverUrl}
              />
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>

      <div className="mt-2">
        <StructuredResponse
          formatName={structuredOutput.formatName}
          data={structuredOutput.data}
          schema={structuredOutput.schema}
        />
      </div>
    </>
  );
});

interface MessageRowProps {
  item: DisplayItem;
  revertMessageId: string | null;
  sessionId: string;
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent?: (sessionId: string) => void;
  onRemoveFromQueue?: (queueId: string) => void;
  onRevert?: (sessionId: string, stepPartId: string) => void;
  onFork?: (sessionId: string, messageId: string) => void;
  isMainActiveSession?: boolean;
  isCompacting?: boolean;
  onCompact?: () => void;
  onEditMessage?: (sessionId: string, messageId: string, content: string) => void;
  serverUrl?: string;
  isPinned?: boolean;
  canPin?: boolean;
  onTogglePinMessage?: (message: Message) => void;
  isPinningMessage?: boolean;
}

const MessageRow = memo(function MessageRow({
  item,
  revertMessageId,
  sessionId,
  pendingAskRequests,
  onAskResponse,
  onNavigateToSubagent,
  onRemoveFromQueue,
  onRevert,
  onFork,
  onEditMessage,
  isMainActiveSession = false,
  isCompacting = false,
  onCompact,
  serverUrl,
  isPinned = false,
  canPin = false,
  onTogglePinMessage,
  isPinningMessage = false,
}: MessageRowProps) {
  const compactionPart = item.parts.find(
    (p): p is CompactionPart => p.type === 'compaction'
  );

  const isCompactFailed = isAssistantMessage(item.message) && item.message.mode === 'compact_failed';

  if (isCompactFailed) {
    return (
      <CompactionFailedMessage
        message={item.message as AssistantMessage}
        textContent={getTextContent(item.parts)}
        onRetry={isMainActiveSession && !isCompacting ? onCompact : undefined}
      />
    );
  }

  const isError = isAssistantMessage(item.message) && item.message.status === 'error';
  const hasContentParts = item.parts.some(p => p.type === 'text' || p.type === 'reasoning' || p.type === 'tool');

  if (isError && !hasContentParts) {
    return (
      <ErrorMessageContent
        message={item.message as AssistantMessage}
      />
    );
  }

  if (compactionPart) {
    return <CompactionDivider part={compactionPart} />;
  }

  const canRevert = !item.isQueued && item.message.role === 'user';
  const canFork = !item.isQueued && (
    (item.message.role === 'user' && revertMessageId !== null) ||
    (isAssistantMessage(item.message) && item.message.status === 'completed')
  );
  const isClearAll = revertMessageId === item.message.id;

  return (
    <>
      <MessageBubble
        message={item.message}
        textContent={getTextContent(item.parts)}
        isQueued={item.isQueued}
        onRemove={item.isQueued && onRemoveFromQueue ? () => onRemoveFromQueue(item.queueId!) : undefined}
        canRevert={canRevert && revertMessageId !== null}
        onRevert={revertMessageId && onRevert ? () => onRevert(sessionId, revertMessageId) : undefined}
        canFork={canFork}
        onFork={canFork && onFork ? () => onFork(sessionId, item.message.id) : undefined}
        canEdit={canRevert && !item.isQueued}
        onEdit={onEditMessage ? (content) => onEditMessage(sessionId, item.message.id, content) : undefined}
        isClearAll={isClearAll}
        isPinned={isPinned}
        canPin={canPin}
        onTogglePin={onTogglePinMessage ? () => onTogglePinMessage(item.message) : undefined}
        isPinningMessage={isPinningMessage}
      >
        {item.parts.length === 0 ? (
          <span className="opacity-50">...</span>
        ) : isAssistantMessage(item.message) && item.message.structuredOutput ? (
          <StructuredOutputMessage
            sessionId={sessionId}
            parts={item.parts}
            structuredOutput={item.message.structuredOutput}
            pendingAskRequests={pendingAskRequests}
            onAskResponse={onAskResponse}
            onNavigateToSubagent={onNavigateToSubagent}
            serverUrl={serverUrl}
          />
        ) : (
          <MessageParts
            sessionId={sessionId}
            parts={item.parts}
            pendingAskRequests={pendingAskRequests}
            onAskResponse={onAskResponse}
            onNavigateToSubagent={onNavigateToSubagent}
            inverted={item.message.role === 'user' && !item.isQueued}
            isStreaming={isAssistantMessage(item.message) && item.message.status === 'streaming'}
            serverUrl={serverUrl}
          />
        )}
      </MessageBubble>
      {isError && (
        <ErrorMessageContent message={item.message as AssistantMessage} />
      )}
    </>
  );
}, areMessageRowPropsEqual);

function areMessageRowPropsEqual(prev: MessageRowProps, next: MessageRowProps): boolean {
  return (
    prev.item.message === next.item.message &&
    prev.item.parts === next.item.parts &&
    prev.item.isQueued === next.item.isQueued &&
    prev.item.queueId === next.item.queueId &&
    prev.revertMessageId === next.revertMessageId &&
    prev.sessionId === next.sessionId &&
    prev.pendingAskRequests === next.pendingAskRequests &&
    prev.onAskResponse === next.onAskResponse &&
    prev.onNavigateToSubagent === next.onNavigateToSubagent &&
    prev.onRemoveFromQueue === next.onRemoveFromQueue &&
    prev.onRevert === next.onRevert &&
    prev.onFork === next.onFork &&
    prev.onEditMessage === next.onEditMessage &&
    prev.isMainActiveSession === next.isMainActiveSession &&
    prev.isCompacting === next.isCompacting &&
    prev.onCompact === next.onCompact &&
    prev.serverUrl === next.serverUrl &&
    prev.isPinned === next.isPinned &&
    prev.canPin === next.canPin &&
    prev.onTogglePinMessage === next.onTogglePinMessage &&
    prev.isPinningMessage === next.isPinningMessage
  );
}

function EmptyTranscript() {
  return (
    <div className="text-center py-16 text-muted-foreground px-4">
      <p className="text-lg mb-2">Start a conversation</p>
      <p className="text-sm">Send a message below to begin.</p>
    </div>
  );
}

function keyExtractor(item: DisplayItem): string {
  return item.message.id;
}

export function VirtualizedTranscript({
  displayItems,
  messagesWithParts,
  sessionId,
  sessionStatus,
  pendingAskRequests,
  isCompacting = false,
  compactionSuccess = false,
  onClearCompactionSuccess,
  onAskResponse,
  onNavigateToSubagent,
  onRemoveFromQueue,
  onRevert,
  onFork,
  onEditMessage,
  onCompact,
  isMainActiveSession = false,
  autoFollow = true,
  onAutoScrollChange,
  scrollToBottomRef,
  serverUrl,
  pinnedMessageIds,
  onTogglePinMessage,
  isPinningMessage,
  targetMessageId,
  onTargetMessageHandled,
  hasOlder = false,
  isLoadingOlder = false,
  loadOlderError = null,
  onLoadOlder,
  emptyContent,
}: VirtualizedTranscriptProps) {
  const listRef = useRef<LegendListRef | null>(null);
  const autoScrollRef = useRef(autoFollow);
  const isProgrammaticScrollRef = useRef(false);
  const followScrollRafRef = useRef<number | null>(null);
  const followScrollTimeoutRef = useRef<number | null>(null);
  const targetMessageIdRef = useRef(targetMessageId);
  const lastUserScrollAtRef = useRef(0);

  const [maintainAutoFollow, setMaintainAutoFollow] = useState(autoFollow);
  const onAutoScrollChangeRef = useRef(onAutoScrollChange);
  useEffect(() => {
    onAutoScrollChangeRef.current = onAutoScrollChange;
  }, [onAutoScrollChange]);

  useLayoutEffect(() => {
    targetMessageIdRef.current = targetMessageId;
  }, [targetMessageId]);
  const [showCompactionBanner, setShowCompactionBanner] = useState(false);

  const scrollToEndForFollow = useCallback(() => {
    if (targetMessageIdRef.current || !autoScrollRef.current) return;

    isProgrammaticScrollRef.current = true;
    const scrollResult = listRef.current?.scrollToEnd({ animated: false });
    void Promise.resolve(scrollResult).finally(() => {
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 100);
    });
  }, []);

  const scheduleFollowScrollToEnd = useCallback(() => {
    if (targetMessageIdRef.current || !autoScrollRef.current) return;

    if (followScrollRafRef.current !== null) {
      cancelAnimationFrame(followScrollRafRef.current);
    }
    if (followScrollTimeoutRef.current !== null) {
      window.clearTimeout(followScrollTimeoutRef.current);
    }

    followScrollRafRef.current = requestAnimationFrame(() => {
      followScrollRafRef.current = requestAnimationFrame(() => {
        followScrollRafRef.current = null;
        scrollToEndForFollow();
      });
    });

    followScrollTimeoutRef.current = window.setTimeout(() => {
      scrollToEndForFollow();
      followScrollTimeoutRef.current = window.setTimeout(() => {
        followScrollTimeoutRef.current = null;
        scrollToEndForFollow();
      }, 300);
    }, 120);
  }, [scrollToEndForFollow]);

  useLayoutEffect(() => {
    setShowCompactionBanner(isCompacting);
  }, [isCompacting]);

  useEffect(() => () => {
    if (followScrollRafRef.current !== null) {
      cancelAnimationFrame(followScrollRafRef.current);
    }
    if (followScrollTimeoutRef.current !== null) {
      window.clearTimeout(followScrollTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (compactionSuccess) {
      const timer = setTimeout(() => {
        onClearCompactionSuccess?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [compactionSuccess, onClearCompactionSuccess]);

  useLayoutEffect(() => {
    if (targetMessageId) {
      autoScrollRef.current = false;
      setMaintainAutoFollow(false);
      return;
    }

    autoScrollRef.current = autoFollow;
    setMaintainAutoFollow(autoFollow);
  }, [autoFollow, targetMessageId]);

  const disableAutoFollowForUserIntent = useCallback(() => {
    if (!autoScrollRef.current) return;

    autoScrollRef.current = false;
    setMaintainAutoFollow(false);
    onAutoScrollChangeRef.current?.(false);
  }, []);

  useLayoutEffect(() => {
    if (displayItems.length === 0) return;
    if (targetMessageId) return;

    autoScrollRef.current = autoFollow;
    setMaintainAutoFollow(autoFollow);
    if (autoFollow) {
      scheduleFollowScrollToEnd();
    }
  }, [sessionId, autoFollow, displayItems.length, targetMessageId, scheduleFollowScrollToEnd]);

  useLayoutEffect(() => {
    if (displayItems.length === 0 || targetMessageId || !autoFollow) return;

    scheduleFollowScrollToEnd();
  }, [displayItems, messagesWithParts, autoFollow, targetMessageId, scheduleFollowScrollToEnd]);

  useLayoutEffect(() => {
    if (scrollToBottomRef) {
      scrollToBottomRef.current = () => {
        autoScrollRef.current = true;
        setMaintainAutoFollow(true);
        scheduleFollowScrollToEnd();
      };
    }
  }, [scrollToBottomRef, scheduleFollowScrollToEnd]);

  useEffect(() => {
    const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
    if (!scrollEl) return;

    let touchStartY = 0;
    let scrollbarDragging = false;

    const markUserScrollInput = () => {
      lastUserScrollAtRef.current = Date.now();
    };

    const onWheel = (event: WheelEvent) => {
      markUserScrollInput();
      if (event.deltaY < 0) {
        disableAutoFollowForUserIntent();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      markUserScrollInput();
      touchStartY = event.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (event: TouchEvent) => {
      markUserScrollInput();
      const currentY = event.touches[0]?.clientY ?? 0;
      if (currentY > touchStartY + 5) {
        disableAutoFollowForUserIntent();
      }
    };

    const onMouseDown = (_event: MouseEvent) => {
      markUserScrollInput();
      scrollbarDragging = true;
    };

    const onMouseMove = () => {
      if (scrollbarDragging) {
        markUserScrollInput();
      }
    };

    const onMouseUp = () => {
      scrollbarDragging = false;
    };

    scrollEl.addEventListener('wheel', onWheel, { passive: true });
    scrollEl.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: true });
    scrollEl.addEventListener('mousedown', onMouseDown, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    window.addEventListener('mouseup', onMouseUp, { passive: true });

    return () => {
      scrollEl.removeEventListener('wheel', onWheel);
      scrollEl.removeEventListener('touchstart', onTouchStart);
      scrollEl.removeEventListener('touchmove', onTouchMove);
      scrollEl.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [disableAutoFollowForUserIntent]);

  useEffect(() => {
    if (!targetMessageId) return;

    const targetIndex = displayItems.findIndex(item => item.message.id === targetMessageId);
    if (targetIndex < 0) return;

    autoScrollRef.current = false;
    setMaintainAutoFollow(false);
    onAutoScrollChangeRef.current?.(false);

    isProgrammaticScrollRef.current = true;
    listRef.current?.scrollToIndex?.({ index: targetIndex, animated: true });
    setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 300);

    const timeout = window.setTimeout(() => {
      onTargetMessageHandled?.();
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [targetMessageId, displayItems, onTargetMessageHandled]);

  const handleScroll = useCallback(() => {
    if (isProgrammaticScrollRef.current) return;

    if (targetMessageIdRef.current) return;

    const state = listRef.current?.getState();
    if (!state) return;

    if (hasOlder && !isLoadingOlder && onLoadOlder) {
      const scrollEl = listRef.current?.getScrollableNode() as HTMLElement | null | undefined;
      if (scrollEl && scrollEl.scrollTop < 200) {
        onLoadOlder();
      }
    }

    if (state.isAtEnd || state.isWithinMaintainScrollAtEndThreshold) {
      // Re-enable follow only on user-driven scrolls (wheel, touch, scrollbar drag).
      // LegendList's internal MVCP corrections use el.scrollBy, which also emits scroll
      // events; treating those as user intent silently re-enables follow on panel toggles.
      const isUserDriven = Date.now() - lastUserScrollAtRef.current < USER_SCROLL_INPUT_WINDOW_MS;
      if (!autoScrollRef.current && isUserDriven) {
        autoScrollRef.current = true;
        setMaintainAutoFollow(true);
        onAutoScrollChangeRef.current?.(true);
      }
      return;
    }


  }, [hasOlder, isLoadingOlder, onLoadOlder]);

  const revertMessageIds = useMemo(() => {
    const ids = new Map<string, string | null>();
    let previousCompletedAssistantId: string | null = null;

    messagesWithParts.forEach(({ message }, index) => {
      if (message.role === 'user') {
        ids.set(message.id, index === 0 ? message.id : previousCompletedAssistantId);
      } else if (message.role === 'assistant' && message.status !== 'streaming') {
        previousCompletedAssistantId = message.id;
      }
    });

    return ids;
  }, [messagesWithParts]);

  const renderItem = useCallback(({ item }: { item: DisplayItem }) => (
    <div
      className={cn(
        'mx-auto w-full max-w-3xl px-4 py-4',
        item.message.id === targetMessageId && 'rounded-lg ring-2 ring-primary/40 bg-primary/5',
      )}
    >
      <MessageRow
        item={item}
        revertMessageId={revertMessageIds.get(item.message.id) ?? null}
        sessionId={sessionId}
        pendingAskRequests={pendingAskRequests}
        onAskResponse={onAskResponse}
        onNavigateToSubagent={onNavigateToSubagent}
        onRemoveFromQueue={onRemoveFromQueue}
        onRevert={onRevert}
        onFork={onFork}
        onEditMessage={onEditMessage}
        isMainActiveSession={isMainActiveSession}
        isCompacting={isCompacting}
        onCompact={onCompact}
        serverUrl={serverUrl}
        isPinned={pinnedMessageIds?.has(item.message.id) ?? false}
        canPin={item.message.role === 'assistant' && !item.isQueued}
        onTogglePinMessage={
          item.message.role === 'assistant' && !item.isQueued
            ? onTogglePinMessage
            : undefined
        }
        isPinningMessage={isPinningMessage}
      />
    </div>
  ), [
    revertMessageIds,
    sessionId,
    pendingAskRequests,
    onAskResponse,
    onNavigateToSubagent,
    onRemoveFromQueue,
    onRevert,
    onFork,
    onEditMessage,
    isMainActiveSession,
    isCompacting,
    onCompact,
    serverUrl,
    pinnedMessageIds,
    onTogglePinMessage,
    isPinningMessage,
    targetMessageId,
  ]);

  // Mutation callbacks must be part of extraData: LegendList re-renders
  // mounted rows on extraData identity change only, so a control-state flip
  // (callbacks withheld/restored) would otherwise leave stale row buttons.
  const listExtraData = useMemo(() => ({
    pendingAskRequests,
    pinnedMessageIds,
    isPinningMessage,
    onRemoveFromQueue,
    onRevert,
    onFork,
    onEditMessage,
    onCompact,
  }), [
    pendingAskRequests,
    pinnedMessageIds,
    isPinningMessage,
    onRemoveFromQueue,
    onRevert,
    onFork,
    onEditMessage,
    onCompact,
  ]);

  const header = (
    <>
      {isLoadingOlder && (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}

      {loadOlderError && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-destructive">
          <span>Failed to load older messages</span>
          <button onClick={onLoadOlder} className="underline hover:text-foreground">Retry</button>
        </div>
      )}

      {showCompactionBanner && (
        <div className="sticky top-0 z-10 px-4 pt-4 pb-1 bg-gradient-to-b from-background via-background/95 to-transparent">
          <CompactionInProgressBanner />
        </div>
      )}

      {compactionSuccess && (
        <div className="sticky top-0 z-10 px-4 pt-4 pb-1 bg-gradient-to-b from-background via-background/95 to-transparent">
          <CompactionSuccessBanner />
        </div>
      )}

      {sessionStatus === 'closed' && (
        <Alert className="mx-4 mt-4">
          <AlertDescription>
            This session is archived. You can reopen it from the sidebar.
          </AlertDescription>
        </Alert>
      )}
    </>
  );

  return (
    <LegendList
      ref={listRef}
      data={displayItems}
      extraData={listExtraData}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      estimatedItemSize={100}
      drawDistance={800}
      initialScrollAtEnd={!targetMessageId && autoFollow}
      maintainScrollAtEnd={!targetMessageId && maintainAutoFollow ? { animated: false } : false}
      maintainScrollAtEndThreshold={0.1}
      maintainVisibleContentPosition={{ data: true, size: false }}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden relative chat-transcript-scrollbar"
      style={{ WebkitOverflowScrolling: 'touch' }}
      ListHeaderComponent={header}
      ListEmptyComponent={emptyContent ? () => emptyContent : EmptyTranscript}
    />
  );
}
