import { X, File } from 'lucide-react';

interface FileMentionChipProps {
  path: string;
  onRemove: (path: string) => void;
  onPreview?: (path: string) => void;
}

export function FileMentionChip({ path, onRemove, onPreview }: FileMentionChipProps) {
  const filename = path.split('/').pop() || path;
  const directory = path.slice(0, path.lastIndexOf('/') + 1);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-primary/15 rounded-lg border border-primary/30 max-w-[220px]">
      <File className="size-4 text-primary shrink-0" />
      <button
        type="button"
        onClick={() => onPreview?.(path)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="text-xs truncate">
          <span className="text-muted-foreground">{directory}</span>
          <span>{filename}</span>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onRemove(path)}
        aria-label={`Remove ${filename}`}
        className="shrink-0 p-0.5 hover:bg-accent rounded"
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}
