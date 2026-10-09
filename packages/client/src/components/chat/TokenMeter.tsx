import { useState } from 'react';
import type { SessionHarnessUsageState } from '@prokopai/sdk';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface TokenMeterProps {
  /** Server-normalized usage from the session's harnessState. The context
   * window may be filled client-side for harnesses that do not report one
   * (prokop: from the model catalog). Null renders the empty ring. */
  usage?: SessionHarnessUsageState | null;
}

function formatCompact(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
  return num.toString();
}

function getUsageStatus(percentage: number): 'normal' | 'warning' | 'critical' {
  if (percentage >= 60) return 'critical';
  if (percentage >= 40) return 'warning';
  return 'normal';
}

export function TokenMeter({ usage = null }: TokenMeterProps) {
  const [showTokens, setShowTokens] = useState(false);

  const used = usage?.used ?? 0;
  const effectiveContext = usage?.contextWindow ?? 0;
  const percentage = effectiveContext === 0
    ? 0
    : Math.min(100, Math.round((used / effectiveContext) * 100));

  const status = getUsageStatus(percentage);

  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - percentage / 100);

  const ringColorClass = percentage === 0
    ? 'text-muted-foreground/30'
    : status === 'critical'
      ? 'text-destructive'
      : status === 'warning'
        ? 'text-warning'
        : 'text-primary';

  const usageRows: Array<[string, string]> = usage && usage.rows.length > 0
    ? usage.rows.map((row) => [row.label, row.value])
    : [['Usage', 'Not reported']];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 select-none"
            onClick={() => setShowTokens((current) => !current)}
            aria-label={`Token usage: ${percentage}% of context window`}
          >
            <svg
              viewBox="0 0 20 20"
              className="size-5"
              fill="none"
            >
              <circle
                cx="10"
                cy="10"
                r={radius}
                stroke="currentColor"
                className="text-muted-foreground/20"
                strokeWidth="3"
              />
              <circle
                cx="10"
                cy="10"
                r={radius}
                stroke="currentColor"
                className={ringColorClass}
                strokeWidth="3"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                transform="rotate(-90 10 10)"
                style={{ transition: 'stroke-dashoffset 0.3s ease' }}
              />
            </svg>
            <span className="text-xs font-mono text-muted-foreground">
              {showTokens ? `${formatCompact(used)}/${formatCompact(effectiveContext)}` : `${percentage}%`}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6} className="flex-col items-stretch gap-1.5">
          <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 font-mono tabular-nums">
            {usageRows.map(([label, value]) => (
              <div key={label} className="contents">
                <span>{label}</span>
                <span className="text-right">{value}</span>
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
