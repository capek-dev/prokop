import { Grid2X2, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';

export function SessionLayoutToggle() {
  const openSessionCount = useSessionBoardStore((state) => state.openSessionIds.length);
  const layoutMode = useSessionBoardStore((state) => state.layoutMode);
  const setLayoutMode = useSessionBoardStore((state) => state.setLayoutMode);

  if (openSessionCount < 2) return null;

  const showingBoard = layoutMode === 'board';
  const label = showingBoard ? 'Show focused session' : 'Show session board';

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center px-1 shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setLayoutMode(showingBoard ? 'focused' : 'board')}
              aria-label={label}
            >
              {showingBoard ? <Square className="size-4" /> : <Grid2X2 className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
