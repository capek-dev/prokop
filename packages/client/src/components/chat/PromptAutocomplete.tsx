import type { PromptInfo } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';

interface PromptAutocompleteProps {
  prompts: PromptInfo[];
  query: string;
  selectedIndex: number;
  onSelect: (prompt: PromptInfo) => void;
}

export function PromptAutocomplete({
  prompts,
  query,
  selectedIndex,
  onSelect,
}: PromptAutocompleteProps) {
  const filtered = prompts.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase())
  );

  if (filtered.length === 0) {
    return (
      <div className="p-2 text-xs text-muted-foreground">
        No prompts matching "/{query}"
      </div>
    );
  }

  return (
    <div className="p-1">
      {filtered.map((prompt, index) => (
        <button
          key={prompt.name}
          onClick={() => onSelect(prompt)}
          className={cn(
            'flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left',
            'hover:bg-muted',
            index === selectedIndex && 'bg-primary/20 text-primary font-medium ring-1 ring-primary/50'
          )}
        >
          <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs">/{prompt.name}</div>
            <div className="text-xs text-muted-foreground truncate">{prompt.description}</div>
          </div>
        </button>
      ))}
      <div className="mt-1 pt-1 border-t text-xs text-muted-foreground px-2">
        {filtered.length} prompt{filtered.length !== 1 ? 's' : ''} •
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> navigate
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">↵</kbd> select
        <kbd className="ml-1 px-1 py-0.5 bg-muted rounded text-[10px]">esc</kbd> close
      </div>
    </div>
  );
}
