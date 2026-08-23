import { memo, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Copy, Check, Loader2, CheckCircle, XCircle, Clock, Pause } from 'lucide-react';
import type { ToolPart, AnyVisualization, AskResponse, Session } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { VisualizationRenderer } from '@/components/visualizations';
import { TerminalOutput } from '@/components/visualizations/TerminalOutput';
import { AskQuestion } from './AskQuestion';
import type { PendingAskRequest } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';
import { getToolRowInfo } from '@/lib/toolSummaries';
import type { ToolRowChip } from '@/lib/toolSummaries';
import { useSdkClient } from '@/contexts/ServerClientContext';
import { useToolDebugQuery, useToolDisplayCatalog } from '@/hooks/queries';

interface LazyOutputProps {
  content: string;
  className?: string;
}

const LazyOutput = memo(function LazyOutput({ content, className }: LazyOutputProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const size = content.length;
  const isLarge = size > RENDER_BUDGETS.toolOutputPreviewChars;
  const preview = isLarge ? content.slice(0, RENDER_BUDGETS.toolOutputPreviewChars) + '\n...' : null;

  if (!isLarge) {
    return <pre className={className}>{content}</pre>;
  }

  const sizeLabel = size > 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : size > 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${size} bytes`;

  return (
    <div>
      <pre className={className}>{isExpanded ? content : preview}</pre>
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-foreground mt-1 transition-colors cursor-pointer"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        {isExpanded ? 'Show less' : `Show full output (${sizeLabel})`}
      </button>
    </div>
  );
});

interface ToolCallProps {
  sessionId: string;
  part: ToolPart;
  pendingAskRequests: PendingAskRequest[];
  onAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  onNavigateToSubagent?: (sessionId: string) => void;
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'pending':
      return <Clock className="size-3 text-warning" />;
    case 'running':
      return <Loader2 className="size-3 text-warning animate-spin" />;
    case 'completed':
      return <CheckCircle className="size-3 text-success" />;
    case 'error':
      return <XCircle className="size-3 text-destructive" />;
    case 'interrupted':
      return <Pause className="size-3 text-warning" />;
    default:
      return null;
  }
}

function extractTaskSessionId(part: ToolPart): string | null {
  if (part.name !== 'task') return null;
  const state = part.state;
  if ('childSessionId' in state && state.childSessionId) {
    return state.childSessionId as string;
  }
  const output = 'output' in state
    ? state.output
    : 'partialOutput' in state
      ? state.partialOutput
      : null;
  if (output && typeof output === 'string') {
    const match = output.match(/task_id:\s*([a-f0-9-]{36})/i);
    if (match) return match[1];
  }
  return null;
}

function extractVisualization(output: unknown): AnyVisualization | undefined {
  if (output && typeof output === 'object' && '_visualization' in output) {
    return (output as Record<string, unknown>)._visualization as AnyVisualization;
  }
  return undefined;
}

function getDescendantSessionIds(parentId: string, sessions: Session[]): Set<string> {
  const descendants = new Set<string>();
  const queue = [parentId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const session of sessions) {
      if (session.parentId === current && !descendants.has(session.id)) {
        descendants.add(session.id);
        queue.push(session.id);
      }
    }
  }

  return descendants;
}

const chipToneClass: Record<ToolRowChip['tone'], string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/15 text-success',
  error: 'bg-red-500/15 text-red-400',
};

const areToolCallPropsEqual = (
  prev: ToolCallProps,
  next: ToolCallProps
): boolean => {
  if (prev.sessionId !== next.sessionId) return false;
  if (prev.part !== next.part) return false;
  if (prev.onNavigateToSubagent !== next.onNavigateToSubagent) return false;
  if (prev.onAskResponse !== next.onAskResponse) return false;
  if (prev.pendingAskRequests !== next.pendingAskRequests) return false;

  return true;
};

export const ToolCall = memo(function ToolCall({
  sessionId,
  part,
  pendingAskRequests,
  onAskResponse,
  onNavigateToSubagent,
}: ToolCallProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const state = part.state;
  const status = state.status;
  const sdkClient = useSdkClient();
  const shouldLoadDebug = part.presentation?.debugAvailable === true;
  const debugQuery = useToolDebugQuery(
    sdkClient,
    sessionId,
    part.id,
    isOpen && shouldLoadDebug,
  );
  const rawInput = shouldLoadDebug ? debugQuery.data?.input : state.input;
  const rawOutput = shouldLoadDebug
    ? debugQuery.data?.output
    : status === 'completed' && 'output' in state
      ? state.output
      : undefined;
  const debugReady = !shouldLoadDebug || debugQuery.data !== undefined;

  const serializedInput = useMemo((): string => {
    if (!isOpen || rawInput === undefined) return '';
    try {
      return JSON.stringify(rawInput, null, 2);
    } catch {
      return String(rawInput);
    }
  }, [rawInput, isOpen]);

  const serializedOutput = useMemo((): string | null => {
    if (!isOpen || rawOutput === undefined) return null;
    return typeof rawOutput === 'string'
      ? rawOutput
      : JSON.stringify(rawOutput, null, 2);
  }, [rawOutput, isOpen]);

  const visualization = part.presentation?.visualization
    ?? (status === 'completed' && 'output' in state
      ? extractVisualization(state.output)
      : undefined);

  const taskSessionId = extractTaskSessionId(part);

  const sessions = useSessionStore((s) => s.sessions);
  const catalog = useToolDisplayCatalog(sdkClient);

  const { summary, chips } = useMemo(() => getToolRowInfo(part, catalog), [part, catalog]);

  const allPendingAsks: PendingAskRequest[] = [];

  if (status === 'pending' || status === 'running') {
    const directAsk = pendingAskRequests.find((r) => r.toolCallId === part.callId);
    if (directAsk) {
      allPendingAsks.push(directAsk);
    }

    if (taskSessionId) {
      const descendantIds = getDescendantSessionIds(taskSessionId, sessions);
      descendantIds.add(taskSessionId);
      const childAsks = pendingAskRequests.filter(
        (r) => {
          const isChildOrDescendant = r.originSessionId && descendantIds.has(r.originSessionId);
          const isDirectChildSession = r.sessionId === taskSessionId;
          return (isChildOrDescendant || isDirectChildSession) && r.toolCallId !== part.callId;
        },
      );
      allPendingAsks.push(...childAsks);
    }
  }

  const handleCopyOutput = async () => {
    if (rawOutput !== undefined) {
      const output = typeof rawOutput === 'string'
        ? rawOutput
        : JSON.stringify(rawOutput, null, 2);
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="my-1">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div
            className="flex items-center gap-2 py-1 cursor-pointer hover:text-foreground transition-colors text-muted-foreground"
          >
            {getStatusIcon(status)}

            {isOpen ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}

            <span className="flex min-w-0 flex-1 items-baseline">
              <span className="text-xs truncate max-w-[120px] sm:max-w-none">{part.name}</span>

              {summary && (
                <span className="text-xs text-muted-foreground font-mono truncate min-w-0 flex-1 hidden sm:inline">
                  {`: ${summary}`}
                </span>
              )}
            </span>

            {chips.map((chip) => (
              <span
                key={chip.label}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 hidden sm:inline ${chipToneClass[chip.tone]}`}
              >
                {chip.label}
              </span>
            ))}

            {taskSessionId && onNavigateToSubagent && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-6 w-6 p-0 sm:w-auto sm:px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onNavigateToSubagent(taskSessionId!);
                }}
                title="View session"
              >
                <ExternalLink className="size-3" />
                <span className="hidden sm:inline ml-1">View</span>
              </Button>
            )}
          </div>
        </CollapsibleTrigger>

        {isOpen && <CollapsibleContent>
          <div className="pl-5 pb-2 flex flex-col gap-2">
            {/* Pretty body for collapsed visualizations (chip-only while collapsed) */}
            {visualization && visualization.collapsed && visualization.type !== 'none' && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Result</div>
                <VisualizationRenderer visualization={visualization} />
              </div>
            )}

            {shouldLoadDebug && debugQuery.isFetching && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="size-3 animate-spin" />
                Loading debug data...
              </div>
            )}

            {shouldLoadDebug && debugQuery.isError && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
                <span>Debug data could not be loaded.</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6"
                  onClick={() => void debugQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            )}

            {debugReady && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Input</div>
                <LazyOutput
                  content={serializedInput}
                  className="text-xs bg-background border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words"
                />
              </div>
            )}

            {/* Subagent Navigation */}
            {(status === 'running' || status === 'completed' || status === 'interrupted') && taskSessionId && onNavigateToSubagent && (
              <Button
                variant="outline"
                className="w-full"
                size="sm"
                onClick={() => onNavigateToSubagent(taskSessionId!)}
              >
                <ExternalLink className="size-4" data-icon="inline-start" />
                {status === 'running' ? 'Watch Subagent' : 'View Session'}
              </Button>
            )}

            {/* Output - raw debug JSON */}
            {debugReady && status === 'completed' && serializedOutput !== null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs uppercase text-muted-foreground">Output</div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopyOutput}
                    className="size-6"
                  >
                    {copied ? (
                      <Check className="size-3 text-success" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </Button>
                </div>
                <LazyOutput
                  content={serializedOutput}
                  className="text-xs bg-success/10 border border-success/20 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words"
                />
              </div>
            )}

            {/* Error */}
            {status === 'error' && 'error' in state && (
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Error</div>
                <pre className="text-xs bg-destructive/10 border border-destructive/20 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words text-destructive">
                  {state.error as string}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>}
      </Collapsible>

      {/* Ask Questions (direct + child session asks) */}
      {allPendingAsks.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {allPendingAsks.map((request) => (
            <AskQuestion
              key={request.requestId ?? request.toolCallId}
              request={request}
              onRespond={onAskResponse}
            />
          ))}
        </div>
      )}

      {/* Content below the row (no click needed): tool-declared visualizations.
          `collapsed: true` means the tool says the row + chip suffices;
          `none` visualizations carry no body. Expand is debug-only. */}
      {status === 'completed' && visualization && !visualization.collapsed && visualization.type !== 'none' && (
        <div className="mt-1">
          {visualization.type === 'shell-output' ? (
            <TerminalOutput stdout={visualization.stdout} stderr={visualization.stderr} />
          ) : (
            <VisualizationRenderer visualization={visualization} />
          )}
        </div>
      )}
    </div>
  );
}, areToolCallPropsEqual);
