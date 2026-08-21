import { memo, useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Copy, Check, Wrench, Loader2, CheckCircle, XCircle, Clock, Pause } from 'lucide-react';
import type { ToolPart, AnyVisualization, AskResponse, Session } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { VisualizationRenderer } from '@/components/visualizations';
import { AskQuestion } from './AskQuestion';
import type { PendingAskRequest } from '@/stores/askStore';
import { useSessionStore } from '@/stores/sessionStore';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

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

const areToolCallPropsEqual = (
  prev: ToolCallProps,
  next: ToolCallProps
): boolean => {
  if (prev.part !== next.part) return false;
  if (prev.onNavigateToSubagent !== next.onNavigateToSubagent) return false;
  if (prev.onAskResponse !== next.onAskResponse) return false;
  if (prev.pendingAskRequests !== next.pendingAskRequests) return false;

  return true;
};

export const ToolCall = memo(function ToolCall({
  part,
  pendingAskRequests,
  onAskResponse,
  onNavigateToSubagent,
}: ToolCallProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const state = part.state;
  const status = state.status;

  const serializedInput = useMemo((): string => {
    if (!isOpen) return '';
    try {
      return JSON.stringify(state.input, null, 2);
    } catch {
      return String(state.input);
    }
  }, [state.input, isOpen]);

  const serializedOutput = useMemo((): string | null => {
    if (!isOpen) return null;
    if (status !== 'completed' || !('output' in state)) return null;
    return typeof state.output === 'string'
      ? state.output
      : JSON.stringify(state.output, null, 2);
  }, [status, state, isOpen]);

  // Extract visualization at component level to render outside collapsible
  const visualization = status === 'completed' && 'output' in state
    ? extractVisualization(state.output)
    : undefined;

  // Extract taskSessionId first so it's available for ask matching
  const taskSessionId = extractTaskSessionId(part);

  // Get sessions from store for descendant matching
  const sessions = useSessionStore((s) => s.sessions);

  // Collect all relevant pending asks for this tool call
  const allPendingAsks: PendingAskRequest[] = [];

  if (status === 'pending' || status === 'running') {
    // Direct ask for this tool call
    const directAsk = pendingAskRequests.find((r) => r.toolCallId === part.callId);
    if (directAsk) {
      allPendingAsks.push(directAsk);
    }

    // For task tools, also surface asks from the child session and its descendants
    if (taskSessionId) {
      const descendantIds = getDescendantSessionIds(taskSessionId, sessions);
      descendantIds.add(taskSessionId); // Include the child session itself
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
    if ('output' in state) {
      const output = typeof state.output === 'string'
        ? state.output
        : JSON.stringify(state.output, null, 2);
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const truncatedArgs = (() => {
    try {
      const args = JSON.stringify(state.input);
      return args.length > 50 ? args.slice(0, 47) + '...' : args;
    } catch {
      return String(state.input);
    }
  })();

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

            <Wrench className="size-3" />
            <span className="text-xs truncate max-w-[120px] sm:max-w-none">{part.name}</span>

            {!isOpen && (
              <span className="text-xs text-muted-foreground font-mono truncate flex-1 min-w-0 hidden sm:block">
                {truncatedArgs}
              </span>
            )}

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
            {/* Input */}
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Input</div>
              <LazyOutput
                content={serializedInput}
                className="text-xs bg-background border rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words"
              />
            </div>

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

            {/* Output - always show raw (visualization shown separately below) */}
            {status === 'completed' && serializedOutput !== null && (
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

      {/* Visualization - outside Collapsible, always visible at bottom */}
      {status === 'completed' && visualization && (
        <div className="mt-2">
          <VisualizationRenderer visualization={visualization} />
        </div>
      )}
    </div>
  );
}, areToolCallPropsEqual);
