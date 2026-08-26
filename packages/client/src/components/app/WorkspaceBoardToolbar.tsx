import { FolderOpen, PanelLeft } from 'lucide-react';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getWorkspaceDisplayName } from '@/lib/workspaceKind';

export interface WorkspaceBoardToolbarProps {
  /** When true, shows the focused workspace name as an indicator. */
  showWorkspaceContext?: boolean;
}

/**
 * Workspace-level toolbar for the board layout.
 * Contains only workspace-scoped controls: sidebar toggle, files/explorer toggle.
 * Session-specific controls live in each SessionPaneHeader.
 */
export function WorkspaceBoardToolbar({ showWorkspaceContext }: WorkspaceBoardToolbarProps = {}) {
  const showFilesPanel = useChatLayoutStore((s) => s.showFilesPanel);
  const setShowFilesPanel = useChatLayoutStore((s) => s.setShowFilesPanel);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const agents = useServerDataStore((s) => s.agents);
  const { toggleSidebar, state: sidebarState } = useSidebar();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="h-10 flex items-stretch shrink-0 border-b border-border bg-card">
        {/* Left: Sidebar toggle */}
        <div className={`flex items-center px-1 shrink-0 ${sidebarState === 'expanded' ? 'bg-muted' : ''}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
              >
                <PanelLeft className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebarState === 'expanded' ? 'Hide Sessions' : 'Show Sessions'}</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 flex items-center min-w-0 px-2">
          {showWorkspaceContext && activeWorkspace && (
            <span
              className="text-xs text-muted-foreground truncate"
              title={getWorkspaceDisplayName(activeWorkspace, agents)}
            >
              {getWorkspaceDisplayName(activeWorkspace, agents)}
            </span>
          )}
        </div>

        {/* Right: Files / Explorer toggle */}
        {activeWorkspace && (
          <>
            <div className={`flex items-center px-1 shrink-0 ${showFilesPanel ? 'bg-muted' : ''}`}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowFilesPanel(!showFilesPanel)}
                  >
                    <FolderOpen className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{showFilesPanel ? 'Hide Files' : 'Show Files'}</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
