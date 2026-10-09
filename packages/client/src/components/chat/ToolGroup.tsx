import type { ReactNode } from 'react';
import { CheckCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { Part } from '@prokopai/sdk';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toolChipToneClass } from '@/lib/toolSummaries';
import { formatDuration } from '@/lib/turnStats';
import { getToolGroupStats } from '@/lib/turnParts';
import { useVizExpandedOverride } from '@/lib/vizExpansion';

interface ToolGroupProps {
  expansionKey: string;
  parts: Part[];
  /** The run is the streaming message's tail: the agent is still working in it. */
  live: boolean;
  children: ReactNode;
}

/**
 * One row for a run of tool calls. Open while the agent works in it, folded
 * once it finishes, unless the user has toggled it.
 */
export function ToolGroup({ expansionKey, parts, live, children }: ToolGroupProps) {
  const stats = getToolGroupStats(parts);
  const [open, setOpen] = useVizExpandedOverride(expansionKey, stats.active || live);
  const names = stats.names
    .map(({ name, count }) => (count > 1 ? `${name} ×${count}` : name))
    .join(' · ');

  return (
    <div className="my-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
          >
            {stats.active
              ? <Loader2 className="size-3 shrink-0 animate-spin text-warning" />
              : <CheckCircle className="size-3 shrink-0 text-success" />}
            {open
              ? <ChevronDown className="size-4 shrink-0" />
              : <ChevronRight className="size-4 shrink-0" />}
            <span className="flex min-w-0 flex-1 items-baseline">
              <span className="shrink-0 text-xs">{stats.toolCount} tool calls</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{`: ${names}`}</span>
            </span>
            {stats.failedCount > 0 && (
              <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${toolChipToneClass.error}`}>
                {stats.failedCount} failed
              </span>
            )}
            {stats.additions > 0 && (
              <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-success/80 sm:inline">
                +{stats.additions}
              </span>
            )}
            {stats.deletions > 0 && (
              <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-destructive/80 sm:inline">
                -{stats.deletions}
              </span>
            )}
            {stats.durationMs !== undefined && (
              <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70 sm:inline">
                {formatDuration(stats.durationMs)}
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        {open && (
          <CollapsibleContent>
            <div className="ml-1.5 border-l border-border/60 pl-3">
              {children}
            </div>
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
