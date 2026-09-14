import { FolderOpen, PanelLeft, Settings, Settings2, SquareTerminal } from 'lucide-react';
import { isWindows } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HeaderPanelTogglesProps {
  sessionsActive: boolean;
  onToggleSessions: () => void;
  filesActive: boolean;
  onToggleFiles: () => void;
  terminalActive: boolean;
  onToggleTerminal: () => void;
  /** True when a workspace is active; gates the Files toggle and the Workspace Settings entry. */
  hasWorkspace: boolean;
  onOpenWorkspaceSettings: () => void;
  onOpenSettings: () => void;
  updateVersion?: string | null;
}

/**
 * Shell panel toggles and settings entry shared by the mobile and desktop
 * headers. Panels are one tap away on both layouts instead of being buried
 * in a collapsed menu on mobile.
 */
export function HeaderPanelToggles({
  sessionsActive,
  onToggleSessions,
  filesActive,
  onToggleFiles,
  terminalActive,
  onToggleTerminal,
  hasWorkspace,
  onOpenWorkspaceSettings,
  onOpenSettings,
  updateVersion,
}: HeaderPanelTogglesProps) {
  const tooltipSide = isWindows() ? 'bottom' : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleSessions}
              aria-pressed={sessionsActive}
              aria-label={sessionsActive ? 'Hide Sessions' : 'Show Sessions'}
              className={sessionsActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {sessionsActive ? 'Hide Sessions' : 'Show Sessions'}
          </TooltipContent>
        </Tooltip>
        {hasWorkspace && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleFiles}
                aria-pressed={filesActive}
                aria-label={filesActive ? 'Hide Files' : 'Show Files'}
                className={filesActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              {filesActive ? 'Hide Files' : 'Show Files'}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleTerminal}
              aria-pressed={terminalActive}
              aria-label={terminalActive ? 'Hide Terminal' : 'Show Terminal'}
              className={terminalActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
            >
              <SquareTerminal className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {terminalActive ? 'Hide Terminal' : 'Show Terminal'}
          </TooltipContent>
        </Tooltip>
        <div className={cn('w-px h-5 bg-border/60 mx-1')} />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative"
                  aria-label={updateVersion ? `Settings, Prokop v${updateVersion} update available` : 'Settings'}
                >
                  <Settings className="h-4 w-4" />
                  {updateVersion && (
                    <span aria-hidden="true" data-update-available className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-background" />
                  )}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              {updateVersion ? `Prokop v${updateVersion} available. Run prokop update on this server.` : 'Settings'}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-52 min-w-52">
            {updateVersion && (
              <>
                <DropdownMenuLabel className="flex flex-col gap-1 whitespace-normal">
                  <span>Prokop v{updateVersion} available</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    Run <code>prokop update</code> in a terminal on the machine hosting this server.
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuGroup>
              {hasWorkspace && (
                <DropdownMenuItem onClick={onOpenWorkspaceSettings}>
                  <Settings2 className="mr-2 h-4 w-4" />
                  Workspace Settings
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onOpenSettings}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </TooltipProvider>
  );
}
