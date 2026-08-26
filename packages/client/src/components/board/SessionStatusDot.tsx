import { useSessionStore } from '@/stores/sessionStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { cn } from '@/lib/utils';

/**
 * Per-session activity dot for board chrome.
 * Pulses while the session is streaming or running, stays quiet otherwise.
 */
export function SessionStatusDot({ sessionId }: { sessionId: string }) {
  const streaming = useConnectionStore(s => s.streamingSessionIds.has(sessionId));
  const runningAt = useSessionStore(s => s.sessions.find(sess => sess.id === sessionId)?.runningAt);
  const active = streaming || !!runningAt;

  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        active ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40',
      )}
    />
  );
}
