import { FileEdit, Plus, Trash2, Search, FileText, Copy } from 'lucide-react';
import { useState, useMemo } from 'react';
import type { FileListItem } from '@prokopai/sdk';
import { cn } from '@/lib/utils';
import { RENDER_BUDGETS } from '@/lib/renderBudgets';

interface FileListGroup {
  label: string;
  files: FileListItem[];
  icon?: 'edit' | 'plus' | 'trash' | 'search';
}

interface FileListViewerProps {
  title?: string;
  groups?: FileListGroup[];
  files?: FileListItem[];
  total?: number;
}

const iconMap = {
  edit: FileEdit,
  plus: Plus,
  trash: Trash2,
  search: Search,
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="Copy path"
    >
      {copied ? (
        <span className="text-success text-xs">Copied!</span>
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

export function FileListViewer({ title, groups, files, total }: FileListViewerProps) {
  const [showAll, setShowAll] = useState(false);
  const defaultGroup: FileListGroup = { label: 'Files', files: files || [], icon: undefined };
  const displayGroups = groups || (files ? [defaultGroup] : []);

  const totalItemCount = useMemo(
    () => displayGroups.reduce((sum, g) => sum + g.files.length, 0),
    [displayGroups],
  );
  const needsTruncation = totalItemCount > RENDER_BUDGETS.fileListMaxItems;

  const visibleGroups = useMemo(() => {
    if (!needsTruncation || showAll) return displayGroups;
    let remaining = RENDER_BUDGETS.fileListMaxItems;
    return displayGroups.map((group) => {
      if (remaining <= 0) return { ...group, files: [] };
      const slice = group.files.slice(0, remaining);
      remaining -= slice.length;
      return { ...group, files: slice };
    });
  }, [displayGroups, needsTruncation, showAll]);

  if (displayGroups.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      {title && (
        <div className="text-sm font-medium text-foreground">
          {title}
          {total !== undefined && (
            <span className="ml-2 text-muted-foreground">({total} files)</span>
          )}
        </div>
      )}

      {visibleGroups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {group.icon && (
              <span className="flex items-center">
                {(() => {
                  const Icon = iconMap[group.icon];
                  return <Icon className="size-3" />;
                })()}
              </span>
            )}
            <span>{group.label}</span>
            <span className="text-muted-foreground/50">({group.files.length})</span>
          </div>

          <div className="flex flex-col gap-0.5 pl-5">
            {group.files.map((file, fileIndex) => (
              <div
                key={fileIndex}
                className="flex items-center gap-2 text-xs group"
              >
                <FileText className="size-3 text-muted-foreground shrink-0" />
                <span className="font-mono text-foreground/80 truncate">
                  {file.path}
                </span>
                {file.line !== undefined && (
                  <span className="text-muted-foreground shrink-0">
                    :{file.line}
                  </span>
                )}
                {file.action && (
                  <span className={cn(
                    'text-xs px-1 rounded shrink-0',
                    file.action === 'created' && 'bg-success/20 text-success',
                    file.action === 'modified' && 'bg-warning/20 text-warning',
                    file.action === 'deleted' && 'bg-destructive/20 text-destructive',
                  )}>
                    {file.action}
                  </span>
                )}
                <CopyButton text={file.path} />
              </div>
            ))}
          </div>
        </div>
      ))}

      {needsTruncation && !showAll && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={() => setShowAll(true)}
        >
          Show all {totalItemCount} files
        </button>
      )}
      {needsTruncation && showAll && (
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          onClick={() => setShowAll(false)}
        >
          Show fewer
        </button>
      )}
    </div>
  );
}
