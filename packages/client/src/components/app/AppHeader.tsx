import { Settings, Settings2, Ellipsis, LayoutGrid, LayoutList, Check } from 'lucide-react';
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
import { useUIStore } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';

export function AppHeader() {
  const router = useRouter();
  const params = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const setShowWorkspaceSettings = useUIStore((s) => s.setShowWorkspaceSettings);
  const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
  const location = useLocation();
  const isOverview = location.pathname.includes('/overview');

  return (
    <>
      <header className="md:hidden sticky top-0 z-40 flex shrink-0 items-center justify-between px-1 pb-2" style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top, 0px))' }}>
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
                <DropdownMenuItem onClick={() => router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } })}>
                  <span className="flex-1">Single workspace</span>
                  {!isOverview && <Check className="size-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.navigate({ to: '/server/$serverId/overview', params: { serverId: params.serverId } })}>
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

      <header className="hidden md:flex h-11 shrink-0 items-center justify-between px-1 py-1.5">
        <ServerSwitcher compact />
        <TooltipProvider>
          <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => router.navigate({ to: '/server/$serverId/workspace', params: { serverId: params.serverId } })}
                    className={!isOverview ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
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
                     className={isOverview ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
                   >
                     <LayoutGrid className="h-4 w-4" />
                   </Button>
                 </TooltipTrigger>
                 <TooltipContent side={isWindows() ? 'bottom' : undefined}>Overview</TooltipContent>
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
