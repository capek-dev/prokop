import type { ReactNode } from 'react';

interface WorkspaceDockProps {
  sessions: ReactNode;
  content: ReactNode;
  panels?: ReactNode;
}

/**
 * Shared workspace shell. Sessions and the primary dock own separate local
 * headers and content without an additional shell-spanning toolbar.
 */
export function WorkspaceDock({
  sessions,
  content,
  panels,
}: WorkspaceDockProps) {
  return (
    <main className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden">
      <div
        data-slot="workspace-dock"
        className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-hidden border-t border-border bg-background"
      >
        <div
          data-slot="workspace-dock-row"
          className="flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden"
        >
          {sessions}
          <div
            data-slot="workspace-primary-dock"
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            {content}
            {panels}
          </div>
        </div>
      </div>
    </main>
  );
}
