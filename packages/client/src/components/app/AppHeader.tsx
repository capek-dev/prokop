import { Settings, Settings2, Ellipsis, LayoutGrid, LayoutList, Check, Bot } from 'lucide-react';
import { useRouter, useParams, useLocation } from '@tanstack/react-router';
import { isWindows } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ServerSwitcher } from '@/components/layout/ServerSwitcher';
import { useConnectionStore } from '@/stores/connectionStore';
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';

export function AppHeader() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const connected = useConnectionStore((s) => s.connected);
  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const setShowWorkspaceSettings = useUIStore((s) => s.setShowWorkspaceSettings);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const location = useLocation();
  const isOverview = location.pathname.includes('/overview');
  const isAgentView = location.pathname.includes('/agent');

  return (
    <>
      <header className="md:hidden flex items-center justify-between pl-3 pr-5 pt-2 sticky top-0 z-40 shrink-0" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))' }}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <ServerSwitcher compact />
            <button className="flex items-center justify-center size-5 rounded-md hover:bg-accent transition-colors" title={connected ? 'Connected' : 'Disconnected'}>
                <span className={`size-2 rounded-full ${connected ? 'bg-success' : 'bg-destructive'}`} />
              </button>
            </div>
        </div>
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
                <DropdownMenuItem onClick={() => router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } })}>
                  <span className="flex-1">Single workspace</span>
                  {!isOverview && !isAgentView && <Check className="size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.navigate({ to: '/server/$serverId/overview', params: { serverId: params.serverId } })}>
                  <span className="flex-1">Overview</span>
                  {isOverview && !isAgentView && <Check className="size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.navigate({ to: '/server/$serverId/agent', params: { serverId: params.serverId } })}>
                  <span className="flex-1">Agents</span>
                  {isAgentView && <Check className="size-4" />}
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
              <DropdownMenuContent align="end" className="w-48 min-w-48">
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

      <header className="hidden md:flex items-center justify-between pl-3 pr-5 pt-2 h-11 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <ServerSwitcher compact />
            <button
              className="flex items-center justify-center size-5 rounded-md hover:bg-accent transition-colors"
              title={connected ? 'Connected' : 'Disconnected'}
            >
              <span className={`size-2 rounded-full ${connected ? 'bg-success' : 'bg-destructive'}`} />
            </button>
          </div>
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } })}
                    className={!isOverview && !isAgentView ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                  >
                    <LayoutList className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isWindows() ? 'bottom' : undefined}>Single workspace</TooltipContent>
              </Tooltip>               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="icon-sm"
                     onClick={() => router.navigate({ to: '/server/$serverId/overview', params: { serverId: params.serverId } })}
                    className={isOverview && !isAgentView ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                   >
                     <LayoutGrid className="h-4 w-4" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side={isWindows() ? 'bottom' : undefined}>Overview</TooltipContent>
               </Tooltip>
               <Tooltip>
                 <TooltipTrigger asChild>
                   <Button
                     variant="ghost"
                     size="icon-sm"
                     onClick={() => router.navigate({ to: '/server/$serverId/agent', params: { serverId: params.serverId } })}
                     className={isAgentView ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                   >
                     <Bot className="h-4 w-4" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side={isWindows() ? 'bottom' : undefined}>Agents</TooltipContent>
               </Tooltip>
            <div className="w-px h-5 bg-border mx-1" />
            {activeWorkspace && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" onClick={() => setShowWorkspaceSettings(true)}>
                    <Settings2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={isWindows() ? 'bottom' : undefined}>Workspace Settings</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setShowSettings(true)}>
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side={isWindows() ? 'bottom' : undefined}>Settings</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </header>
    </>
  );
}
