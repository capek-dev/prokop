import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

interface DisclosureRowProps {
  label: string;
  /** Value recap shown right-aligned on the trigger; a null summary keeps the row collapsed. */
  summary: string | null;
  /** Bordered rows sit inside cards with hairlines; unbordered rows stand alone. */
  bordered?: boolean;
  /** Defaults to open when a summary exists. */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function DisclosureRow({ label, summary, bordered = false, defaultOpen = summary !== null, children }: DisclosureRowProps) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        className={cn(
          'group flex w-full items-center gap-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
          bordered ? 'border-t px-3' : 'rounded-md px-2',
        )}
      >
        <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <span className="shrink-0">{label}</span>
        {summary && <span className="ml-auto truncate text-xs" title={summary}>{summary}</span>}
      </CollapsibleTrigger>
      <CollapsibleContent className={bordered ? 'px-3 py-3' : 'py-1'}>{children}</CollapsibleContent>
    </Collapsible>
  );
}
