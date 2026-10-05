import { PanelBottom, PanelLeft, PanelRight, Settings } from 'lucide-react';
import { isWindows } from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface HeaderPanelTogglesProps {
  leftActive: boolean;
  onToggleLeft: () => void;
  rightActive: boolean;
  onToggleRight: () => void;
  bottomActive: boolean;
  onToggleBottom: () => void;
  /** Whether the right dock has content in the current scope. */
  hasRightDock: boolean;
  mobile?: boolean;
  onOpenSettings: () => void;
  updateVersion?: string | null;
}

/**
 * Shell panel toggles and settings entry shared by the mobile and desktop
 * headers. Panels are one tap away on both layouts instead of being buried
 * in a collapsed menu on mobile.
 */
export function HeaderPanelToggles({
  leftActive,
  onToggleLeft,
  rightActive,
  onToggleRight,
  bottomActive,
  onToggleBottom,
  hasRightDock,
  mobile = false,
  onOpenSettings,
  updateVersion,
}: HeaderPanelTogglesProps) {
  const leftLabel = mobile ? 'Sessions' : 'left dock';
  const rightLabel = mobile ? 'Files' : 'right dock';
  const bottomLabel = mobile ? 'Terminal' : 'bottom dock';
  const tooltipSide = isWindows() ? 'bottom' : undefined;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleLeft}
              aria-pressed={leftActive}
              aria-label={`${leftActive ? 'Hide' : 'Show'} ${leftLabel}`}
              className={leftActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
            >
              <PanelLeft />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {`${leftActive ? 'Hide' : 'Show'} ${leftLabel}`}
          </TooltipContent>
        </Tooltip>
        {hasRightDock && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleRight}
                aria-pressed={rightActive}
                aria-label={`${rightActive ? 'Hide' : 'Show'} ${rightLabel}`}
                className={rightActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              {`${rightActive ? 'Hide' : 'Show'} ${rightLabel}`}
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleBottom}
              aria-pressed={bottomActive}
              aria-label={`${bottomActive ? 'Hide' : 'Show'} ${bottomLabel}`}
              className={bottomActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : ''}
            >
              <PanelBottom />
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {`${bottomActive ? 'Hide' : 'Show'} ${bottomLabel}`}
          </TooltipContent>
        </Tooltip>
        <div className={cn('w-px h-5 bg-border/60 mx-1')} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={onOpenSettings}
              aria-label={updateVersion ? `Settings, Prokop v${updateVersion} update available` : 'Settings'}
            >
              <Settings className="h-4 w-4" />
              {updateVersion && (
                <span aria-hidden="true" data-update-available className="absolute right-1 top-1 size-1.5 rounded-full bg-primary ring-2 ring-background" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>
            {updateVersion ? `Prokop v${updateVersion} available. Run prokop update on this server.` : 'Settings'}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
