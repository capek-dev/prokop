import { X, FileIcon, Image as ImageIcon } from 'lucide-react';
import type { AttachmentKind } from '@prokopai/sdk';
import { cn } from '@/lib/utils';

interface PendingAttachmentProps {
  id: string;
  kind: AttachmentKind;
  filename: string;
  previewUrl?: string;
  size: number;
  isUploading?: boolean;
  onRemove: (id: string) => void;
}

export function PendingAttachment({ id, kind, filename, size, previewUrl, isUploading, onRemove }: PendingAttachmentProps) {
  return (
    <div className={cn("flex items-center gap-2 px-2 py-1.5 bg-muted rounded-lg border border-border max-w-[180px]", isUploading && "opacity-50")}>
      {kind === 'image' && previewUrl ? (
        <img src={previewUrl} alt={filename} className="size-8 rounded object-cover shrink-0" />
      ) : kind === 'image' ? (
        <ImageIcon className="size-4 text-muted-foreground shrink-0" />
      ) : (
        <FileIcon className="size-4 text-muted-foreground shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate">{filename}</div>
        <div className="text-[10px] text-muted-foreground">{formatSize(size)}</div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(id)}
        className="shrink-0 p-0.5 hover:bg-accent rounded"
      >
        <X className="size-3 text-muted-foreground" />
      </button>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
