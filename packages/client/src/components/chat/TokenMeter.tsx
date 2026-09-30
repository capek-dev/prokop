import { useState } from 'react';
import { Zap } from 'lucide-react';
import type { SessionHarnessUsageState } from '@prokopai/sdk';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TokenMeterProps {
  /** Server-normalized usage from the session's harnessState; null renders
   * the unknown state. */
  usage?: SessionHarnessUsageState | null;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function TokenMeter({
  usage = null,
}: TokenMeterProps) {
  const [open, setOpen] = useState(false);

  if (!usage || usage.contextWindow === 0) {
    const total = usage ? usage.used : 0;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
              aria-label="Token usage"
              disabled={total === 0}
            >
              <Zap className="size-3" />
              {total > 0 ? formatNumber(total) : '—'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{total > 0 ? `${formatNumber(total)} tokens` : 'No usage reported yet'}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const percent = Math.min(100, Math.round((usage.used / usage.contextWindow) * 100));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
                aria-label="Token usage"
              >
                <Zap className="size-3" />
                <span className="tabular-nums">{percent}%</span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{`${formatNumber(usage.used)} / ${formatNumber(usage.contextWindow)} tokens`}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent align="end" sideOffset={4} className="w-56 p-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Context used</span>
            <span className="tabular-nums font-medium">{formatNumber(usage.used)} / {formatNumber(usage.contextWindow)}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          {usage.rows.length > 0 && (
            <div className="mt-2 space-y-1">
              {usage.rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="tabular-nums">{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
