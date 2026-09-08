import { startTransition, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChatLoadingState } from '@/components/shared/LoadingSkeleton';

/** Key this boundary by session so cached transcripts also yield to navigation. */
export function DeferredConversation({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // One rAF runs before paint. The second gives the lightweight pane a paint
    // opportunity before mounting markdown, tool previews, and the virtualizer.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!cancelled) startTransition(() => setReady(true));
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  return ready ? children : <ChatLoadingState />;
}
