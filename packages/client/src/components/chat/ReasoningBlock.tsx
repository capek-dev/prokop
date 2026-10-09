import type { ReactNode } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { formatElapsed } from '@/lib/turnStats';
import { useVizExpanded } from '@/lib/vizExpansion';

interface ReasoningBlockProps {
  expansionKey: string;
  durationMs?: number;
  children: ReactNode;
}

/** Finished reasoning, folded to one line. Live reasoning renders unfolded elsewhere. */
export function ReasoningBlock({ expansionKey, durationMs, children }: ReasoningBlockProps) {
  const [open, setOpen] = useVizExpanded(expansionKey, false);

  return (
    <div className="my-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3 shrink-0" />
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span>{durationMs !== undefined ? `Thought for ${formatElapsed(durationMs)}` : 'Thought'}</span>
      </button>
      {open && (
        <div className="visualization-container my-2 border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground wrap-break-word">
          {children}
        </div>
      )}
    </div>
  );
}
