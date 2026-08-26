import { Check, Ellipsis, FolderOpen, LayoutGrid, LayoutList, PanelLeft, Settings, Settings2, SquareTerminal } from 'lucide-react';
import { useRouter, useParams, useLocation } from '@tanstack/react-router';
import { isWindows } from '@/lib/platform';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ServerSwitcher } from '@/components/layout/ServerSwitcher';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

/**
 * Single title bar: server context and view navigation on the left, shell
 * panel toggles and settings on the right. Per-surface headers live inside
 * their own cards.
 */
export function AppHeader() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const location = useLocation();
  const isOverview = location.pathname.includes('/overview');
  const isMobile = useIsMobile();

  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const setShowWorkspaceSettings = useUIStore((s) => s.setShowWorkspaceSettings);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);

  const { toggleSidebar, state: sidebarState } = useSidebar();
  const showFilesPanel = useChatLayoutStore((s) => s.showFilesPanel);
  const setShowFilesPanel = useChatLayoutStore((s) => s.setShowFilesPanel);
  const mobileSurface = useChatLayoutStore((s) => s.mobileSurface);
  const setMobileSurface = useChatLayoutStore((s) => s.setMobileSurface);
  const showTerminalPanel = useChatLayoutStore((s) => s.showTerminalPanel);
  const setShowTerminalPanel = useChatLayoutStore((s) => s.setShowTerminalPanel);

  const sessionsActive = isMobile
    ? mobileSurface === 'sessions'
    : sidebarState === 'expanded';
  const filesActive = isMobile
    ? mobileSurface === 'files' || mobileSurface === 'editor'
    : showFilesPanel;

  const goWorkspace = () =>
    router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } });
  const goOverview = () =>
    router.navigate({ to: '/server/$serverId/overview', params: { serverId: params.serverId } });

  const toggleSessions = () => {
    if (isMobile) {
      setMobileSurface(sessionsActive ? 'chat' : 'sessions');
    } else {
      toggleSidebar();
    }
  };
  const toggleFiles = () => {
    if (isMobile) {
      setMobileSurface(filesActive ? 'chat' : 'files');
    } else {
      setShowFilesPanel(!showFilesPanel);
    }
  };

  return (
    <>
      <header
        className="md:hidden sticky top-0 z-40 flex shrink-0 items-center justify-between px-1 pb-2"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}
      >
        <ServerSwitcher compact />
        <TooltipProvider>
          <div className="flex items-center gap-1">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      {isOverview ? <LayoutGrid className="w-4 h-4" /> : <LayoutList className="w-4 h-4" />}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>View</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48 min-w-48">
                <DropdownMenuItem onClick={goWorkspace}>
                  <span className="flex-1">Single workspace</span>
                  {!isOverview && <Check className="size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={goOverview}>
                  <span className="flex-1">Overview</span>
                  {isOverview && <Check className="size-4" />}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <Ellipsis className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>More</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52 min-w-52">
                <DropdownMenuItem onClick={toggleSessions}>
                  <PanelLeft className="mr-2 h-4 w-4" />
                  <span className="flex-1">Sessions</span>
                  {sessionsActive && <Check className="size-4" />}
                </DropdownMenuItem>
                {activeWorkspace && (
                  <DropdownMenuItem onClick={toggleFiles}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    <span className="flex-1">Files</span>
                    {filesActive && <Check className="size-4" />}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowTerminalPanel(!showTerminalPanel)}>
                  <SquareTerminal className="mr-2 h-4 w-4" />
                  <span className="flex-1">Terminal</span>
                  {showTerminalPanel && <Check className="size-4" />}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {activeWorkspace && (
                  <DropdownMenuItem onClick={() => setShowWorkspaceSettings(true)}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    Workspace Settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowSettings(true)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      </header>

      <header className="hidden md:flex h-11 shrink-0 items-center justify-between gap-2 px-2">
        <div className="flex min-w-0 items-center gap-2">
          <ServerSwitcher compact />
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={goWorkspace}
              aria-pressed={!isOverview}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                isOverview
                  ? 'text-muted-foreground hover:text-foreground'
                  : 'bg-background text-foreground shadow-sm',
              )}
            >
              <LayoutList className="size-3.5" />
              Workspace
            </button>
            <button
              type="button"
              onClick={goOverview}
              aria-pressed={isOverview}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                isOverview
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid className="size-3.5" />
              Overview
            </button>
          </div>
        </div>

        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={toggleSessions}
                  aria-pressed={sessionsActive}
                  className={sessionsActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                >
                  <PanelLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isWindows() ? 'bottom' : undefined}>
                {sessionsActive ? 'Hide Sessions' : 'Show Sessions'}
              </TooltipContent>
            </Tooltip>
            {activeWorkspace && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={toggleFiles}
                    aria-pressed={filesActive}
                    className={filesActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isWindows() ? 'bottom' : undefined}>
                  {filesActive ? 'Hide Files' : 'Show Files'}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowTerminalPanel(!showTerminalPanel)}
                  aria-pressed={showTerminalPanel}
                  className={showTerminalPanel ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                >
                  <SquareTerminal className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isWindows() ? 'bottom' : undefined}>
                {showTerminalPanel ? 'Hide Terminal' : 'Show Terminal'}
              </TooltipContent>
            </Tooltip>
            <div className="w-px h-5 bg-border/60 mx-1" />
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm">
                      <Settings className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side={isWindows() ? 'bottom' : undefined}>Settings</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-52 min-w-52">
                {activeWorkspace && (
                  <DropdownMenuItem onClick={() => setShowWorkspaceSettings(true)}>
                    <Settings2 className="mr-2 h-4 w-4" />
                    Workspace Settings
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setShowSettings(true)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TooltipProvider>
      </header>
    </>
  );
}
