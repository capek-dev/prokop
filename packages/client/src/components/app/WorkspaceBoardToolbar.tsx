import { useServerDataStore } from '@/stores/serverDataStore';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';
import {
  SessionsVisibilityButton,
  WorkbenchVisibilityButton,
} from '@/components/app/WorkspaceBar';

export interface WorkspaceBoardToolbarProps {
  /** When true, shows the focused workspace name as an indicator. */
  showWorkspaceContext?: boolean;
}

/** Dock-local controls for the multi-session board surface. */
export function WorkspaceBoardToolbar({ showWorkspaceContext }: WorkspaceBoardToolbarProps = {}) {
  const activeWorkspace = useServerDataStore((state) => state.activeWorkspace);
  const agents = useServerDataStore((state) => state.agents);

  return (
    <div
      data-slot="primary-dock-header"
      className="flex h-10 shrink-0 items-stretch border-b border-border bg-card"
    >
      <SessionsVisibilityButton />
      <div className="flex min-w-0 flex-1 items-center px-2">
        {showWorkspaceContext && activeWorkspace && (
          <span
            className="truncate text-xs text-muted-foreground"
            title={getWorkspaceDisplayName(activeWorkspace, agents)}
          >
            {getWorkspaceDisplayName(activeWorkspace, agents)}
          </span>
        )}
      </div>
      <WorkbenchVisibilityButton />
    </div>
  );
}
