import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

interface ReconnectStatusProps {
  authError: string | null;
  nextRetryIn: number;
  onRetry: () => void;
}

/** Mount only while disconnected, keyed by server, so brief switches stay quiet. */
export function ReconnectStatus({ authError, nextRetryIn, onRetry }: ReconnectStatusProps) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="absolute right-2 top-full z-40 mt-1 flex max-w-[calc(100%-1rem)] items-center gap-2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
      <span role="status">
        {authError ?? (nextRetryIn > 0 ? `Reconnecting in ${nextRetryIn}s...` : 'Reconnecting...')}
      </span>
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Retry now
      </Button>
    </div>
  );
}
