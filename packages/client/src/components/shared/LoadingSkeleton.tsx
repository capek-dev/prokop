import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

export function SessionListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-col gap-1 mt-4">
        <Skeleton className="h-4 w-16" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </div>
  );
}

export function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-12" />
      </div>
      <Skeleton className="h-20 w-[70%] rounded-2xl" />
    </div>
  );
}

/** Loads that finish within this window never show a placeholder. */
export const CHAT_PLACEHOLDER_DELAY_MS = 300;

/**
 * Empty transcript shape while a conversation loads. Nothing is drawn for
 * fast loads, and slow loads get static message outlines instead of a
 * spinner, so switching sessions never flashes the pane.
 */
export function ChatLoadingState() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), CHAT_PLACEHOLDER_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <p role="status" className="sr-only">Loading conversation...</p>
      {visible && (
        <div data-slot="chat-placeholder" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-6">
          <div className="ml-auto h-10 w-2/5 rounded-xl bg-muted/60" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-11/12 rounded bg-muted/60" />
            <div className="h-3 w-4/5 rounded bg-muted/60" />
            <div className="h-3 w-3/5 rounded bg-muted/60" />
          </div>
          <div className="ml-auto h-10 w-1/3 rounded-xl bg-muted/60" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-5/6 rounded bg-muted/60" />
            <div className="h-3 w-2/3 rounded bg-muted/60" />
          </div>
        </div>
      )}
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="p-3">
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

interface ConnectingStateProps {
  message?: string;
}

export function ConnectingState({ message = 'Connecting to server...' }: ConnectingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
      <Loader2 className="size-8 animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
