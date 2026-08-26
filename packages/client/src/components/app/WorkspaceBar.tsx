import type { ReactNode } from 'react';
import { FolderOpen, PanelLeft } from 'lucide-react';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSidebar } from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface DockVisibilityButtonProps {
  active: boolean;
  label: string;
  onToggle: () => void;
  children: ReactNode;
}

function DockVisibilityButton({
  active,
  label,
  onToggle,
  children,
}: DockVisibilityButtonProps) {
  return (
    <div className={cn('flex shrink-0 items-center px-1', active && 'bg-muted')}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={onToggle}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function SessionsVisibilityButton() {
  const isMobile = useIsMobile();
  const { toggleSidebar, state: sidebarState } = useSidebar();
  const mobileSurface = useChatLayoutStore((state) => state.mobileSurface);
  const setMobileSurface = useChatLayoutStore((state) => state.setMobileSurface);
  const sessionsActive = isMobile
    ? mobileSurface === 'sessions'
    : sidebarState === 'expanded';
  const label = sessionsActive ? 'Hide Sessions' : 'Show Sessions';

  return (
    <TooltipProvider delayDuration={300}>
      <DockVisibilityButton
        active={sessionsActive}
        label={label}
        onToggle={() => {
          if (isMobile) {
            setMobileSurface(sessionsActive ? 'chat' : 'sessions');
          } else {
            toggleSidebar();
          }
        }}
      >
        <PanelLeft className="size-4" />
      </DockVisibilityButton>
    </TooltipProvider>
  );
}

export function WorkbenchVisibilityButton() {
  const isMobile = useIsMobile();
  const activeWorkspace = useServerDataStore((state) => state.activeWorkspace);
  const showFilesPanel = useChatLayoutStore((state) => state.showFilesPanel);
  const setShowFilesPanel = useChatLayoutStore((state) => state.setShowFilesPanel);
  const mobileSurface = useChatLayoutStore((state) => state.mobileSurface);
  const setMobileSurface = useChatLayoutStore((state) => state.setMobileSurface);

  if (!activeWorkspace) return null;

  const filesActive = isMobile
    ? mobileSurface === 'files' || mobileSurface === 'editor'
    : showFilesPanel;
  const label = filesActive ? 'Hide Files' : 'Show Files';

  return (
    <TooltipProvider delayDuration={300}>
      <DockVisibilityButton
        active={filesActive}
        label={label}
        onToggle={() => {
          if (isMobile) {
            setMobileSurface(filesActive ? 'chat' : 'files');
          } else {
            setShowFilesPanel(!showFilesPanel);
          }
        }}
      >
        <FolderOpen className="size-4" />
      </DockVisibilityButton>
    </TooltipProvider>
  );
}
