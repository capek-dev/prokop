import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AskResponse, Session } from '@prokopai/sdk';
import { AskQuestion } from './AskQuestion';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/stores/sessionStore';
import type { PendingAskRequest } from '@/stores/askStore';

/** Synthetic tool-call prefixes used by native harness approvals. */
const NATIVE_APPROVAL_PREFIXES = ['claude-approval:', 'codex-approval:'] as const;

function isNativeApprovalToolCallId(toolCallId: string): boolean {
  return NATIVE_APPROVAL_PREFIXES.some((prefix) => toolCallId.startsWith(prefix));
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

/**
 * Decides which pending asks are answerable from the session being viewed:
 * - Capek asks from this session or any descendant subagent session.
 * - Native harness approvals only for the controlling client, matching the
 *   session they belong to (previously rendered below the transcript).
 */
export function filterDockAskRequests(
  requests: PendingAskRequest[],
  sessionId: string,
  descendantIds: ReadonlySet<string>,
  nativeApprovalPrefix: string | null | undefined,
  canAnswerNative: (requestSessionId: string) => boolean,
): PendingAskRequest[] {
  return requests.filter((request) => {
    if (nativeApprovalPrefix != null && request.toolCallId.startsWith(nativeApprovalPrefix)) {
      return (request.sessionId === sessionId || request.originSessionId === sessionId)
        && canAnswerNative(request.sessionId);
    }
    // Approvals belonging to another harness never surface here; they are
    // answered from their own session view.
    if (isNativeApprovalToolCallId(request.toolCallId)) {
      return false;
    }
    const own = request.sessionId === sessionId || request.originSessionId === sessionId;
    if (own) return true;
    return descendantIds.has(request.sessionId)
      || (request.originSessionId != null && descendantIds.has(request.originSessionId));
  });
}

interface PendingAskDockProps {
  /** Session whose transcript is on screen. */
  sessionId: string;
  /** Pending requests; a superset is fine, the dock filters per session. */
  requests: PendingAskRequest[];
  /** Native harness approval prefix for this session, when applicable. */
  nativeApprovalPrefix?: string | null;
  /** Whether this client may answer the native approval of a given session. */
  canAnswerNative?: (requestSessionId: string) => boolean;
  onRespond: (toolCallId: string, response: AskResponse, requestId?: string) => void;
}

/**
 * Bottom dock for pending asks. Renders one card at a time between the
 * transcript and the input so asks are always visible without scrolling and
 * never cover transcript text; a pager cycles through stacked requests.
 */
export function PendingAskDock({
  sessionId,
  requests,
  nativeApprovalPrefix,
  canAnswerNative,
  onRespond,
}: PendingAskDockProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const descendantIds = useMemo(
    () => getDescendantSessionIds(sessionId, sessions),
    [sessionId, sessions],
  );
  const visible = useMemo(
    () => filterDockAskRequests(
      requests,
      sessionId,
      descendantIds,
      nativeApprovalPrefix,
      canAnswerNative ?? (() => false),
    ),
    [requests, sessionId, descendantIds, nativeApprovalPrefix, canAnswerNative],
  );

  // Manual navigation pins a card; without it the dock follows the newest ask.
  // When the pinned card resolves, the pin falls back to the newest remaining.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);

  if (visible.length === 0) {
    return null;
  }

  const keys = visible.map((request) => request.requestId ?? request.toolCallId);
  let activeIndex = visible.length - 1;
  if (pinnedKey != null) {
    const pinnedIndex = keys.indexOf(pinnedKey);
    if (pinnedIndex >= 0) {
      activeIndex = pinnedIndex;
    }
  }

  const goTo = (target: number) => {
    const clamped = Math.min(Math.max(target, 0), visible.length - 1);
    setPinnedKey(keys[clamped] ?? null);
  };

  return (
    <div
      data-testid="pending-ask-dock"
      className="mx-auto w-full max-w-3xl shrink-0 px-4 py-3"
    >
      {visible.length > 1 && (
        <div className="flex items-center justify-between gap-2 pb-1.5">
          <span className="text-xs tabular-nums text-muted-foreground">
            {activeIndex + 1} / {visible.length} pending
          </span>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={activeIndex === 0}
              onClick={() => goTo(activeIndex - 1)}
              aria-label="Previous pending request"
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={activeIndex === visible.length - 1}
              onClick={() => goTo(activeIndex + 1)}
              aria-label="Next pending request"
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
      {/* Tall cards (long commands, many options) scroll internally instead of
          starving the transcript; the pager stays outside the scroll area. */}
      <div className="max-h-[40vh] overflow-y-auto">
        <AskQuestion
          key={keys[activeIndex]}
          request={visible[activeIndex]!}
          onRespond={onRespond}
        />
      </div>
    </div>
  );
}
