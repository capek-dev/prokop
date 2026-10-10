import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiError, type GitPushErrorDetails } from '@prokopai/sdk';

/** Matches the server's push limit (PUSH_TIMEOUT_MS). */
const PUSH_LIMIT = '10 minutes';

export interface PushFailure {
  message: string;
  reason?: GitPushErrorDetails['reason'];
  output?: string;
}

/** Reads a push error: the server's reason and Git output, or a dropped connection. */
export function pushFailure(error: unknown): PushFailure {
  if (error instanceof ApiError) {
    const details = (error.details ?? {}) as GitPushErrorDetails;
    return { message: error.message, reason: details.reason, output: details.output || undefined };
  }
  // fetch rejects with TypeError when the connection drops; Git keeps running on the server.
  if (error instanceof TypeError) return { message: 'Lost the connection to the server. Git may still finish there; branch status updates when it does.' };
  return { message: error instanceof Error ? error.message : 'Push failed' };
}

/** Hook and timeout failures are the ones skipping hooks can get past. */
export function canRetryWithoutHooks(failure: PushFailure | null, ranHooks: boolean): boolean {
  return ranHooks && (failure?.reason === 'pre-push-hook' || failure?.reason === 'timeout');
}

export function GitOutput({ output }: { output?: string }) {
  if (!output) return null;
  return <details className="text-xs">
    <summary className="cursor-pointer text-muted-foreground">Git output</summary>
    <pre className="dialog-scrollbar mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground/80">{output}</pre>
  </details>;
}

function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Live "Pushing… 42s" line so a long pre-push hook reads as progress, not a hang. */
export function PushProgress({ label, startedAt, runHooks }: { label: string; startedAt: number; runHooks: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <p role="status" className="flex shrink-0 items-center gap-2 px-3 pb-2 text-xs text-muted-foreground">
    <Loader2 className="size-3.5 shrink-0 animate-spin" />
    <span className="min-w-0 break-words">
      {label}… <span className="tabular-nums">{elapsedLabel(now - startedAt)}</span>. {runHooks ? `Waiting for Git, including pre-push hooks. Git stops after ${PUSH_LIMIT}.` : 'Skipping pre-push hooks.'}
    </span>
  </p>;
}
