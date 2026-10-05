import type { ReactNode } from 'react';

interface WorkspaceDockProps {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
  bottom?: ReactNode;
}

/**
 * Positional slots contain views without assigning a content type to a region.
 */
export function WorkspaceDock({
  left,
  center,
  right,
  bottom,
}: WorkspaceDockProps) {
  return (
    <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      <div
        data-slot="workspace-dock"
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden bg-background md:p-2 md:pt-1.5"
      >
        <div
          data-slot="workspace-dock-row"
          className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
        >
          {left}
          <div
            data-slot="workspace-primary-dock"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div data-slot="workspace-center-row" className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              {center}
              {right}
            </div>
            {bottom}
          </div>
        </div>
      </div>
    </main>
  );
}
