import type { ReactNode } from 'react';
import { useDockStore } from '@/stores/dockStore';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppFrameSkeletonProps {
  /** One line of status shown inside the empty center pane. */
  status?: string;
  /** Secondary actions under the status (retry, change server). */
  children?: ReactNode;
}

function Bar({ className }: { className: string }) {
  return <div className={`rounded-md bg-muted/70 ${className}`} />;
}

/**
 * The app frame as it will appear once loaded: title bar, docks at their
 * saved sizes, and an empty center pane. Shown while startup, server
 * bootstrap, and the first connection are pending, so the window never
 * flashes to a blank page with a spinner.
 */
export function AppFrameSkeleton({ status, children }: AppFrameSkeletonProps) {
  const isMobile = useIsMobile();
  const left = useDockStore((s) => s.docks.left);
  const right = useDockStore((s) => s.docks.right);

  const statusBlock = (status || children) && (
    <div className="flex flex-col items-center gap-2 text-center">
      {status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
      {children}
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex size-full flex-col bg-background" aria-busy="true">
        <div
          className="flex shrink-0 items-center justify-between px-3 pb-2"
          style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}
        >
          <Bar className="h-6 w-28" />
          <Bar className="h-6 w-16" />
        </div>
        <div className="flex flex-1 items-center justify-center p-4">{statusBlock}</div>
      </div>
    );
  }

  return (
    <div className="flex size-full flex-col bg-background" aria-busy="true">
      <div className="app-titlebar flex h-11 shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bar className="h-7 w-32" />
          <Bar className="h-7 w-44" />
        </div>
        <div className="flex items-center gap-1">
          <Bar className="size-7" />
          <Bar className="size-7" />
          <Bar className="size-7" />
          <Bar className="size-7" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 p-2 pt-1.5">
        {left.open && (
          <>
            <div
              className="flex shrink-0 flex-col gap-2 rounded-xl border border-border/50 bg-sidebar p-3"
              style={{ width: left.size }}
            >
              <Bar className="h-8 w-full" />
              <Bar className="mt-3 h-3 w-16" />
              <Bar className="h-7 w-full" />
              <Bar className="h-7 w-5/6" />
              <Bar className="h-7 w-4/6" />
            </div>
            <div className="w-3 shrink-0" />
          </>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-xl border border-border/50 bg-card">
          {statusBlock}
        </div>
        {right.open && (
          <>
            <div className="w-3 shrink-0" />
            <div
              className="flex shrink-0 flex-col gap-2 rounded-xl border border-border/50 bg-sidebar p-3"
              style={{ width: right.size }}
            >
              <Bar className="h-7 w-40" />
              <Bar className="mt-2 h-5 w-full" />
              <Bar className="h-5 w-5/6" />
              <Bar className="h-5 w-4/6" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
