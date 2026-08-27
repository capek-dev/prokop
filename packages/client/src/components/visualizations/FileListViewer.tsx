import { FileEdit, Plus, Trash2, Search, FileText, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
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
  singularLabel?: string;
  pluralLabel?: string;
}

const iconMap = {
  edit: FileEdit,
  plus: Plus,
  trash: Trash2,
  search: Search,
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/fl-row:opacity-100"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  );
}

function FileRows({ files, copyLabel }: { files: FileListItem[]; copyLabel: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      {files.map((file, index) => (
        <div
          key={index}
          className="group/fl-row flex min-w-0 items-center gap-2 text-xs"
        >
          <FileText className="size-3 shrink-0 text-muted-foreground/50" />
          <span className="min-w-0 truncate font-mono text-foreground/80">
            {file.path}
          </span>
          {file.line !== undefined && (
            <span className="shrink-0 tabular-nums text-muted-foreground/60">
              :{file.line}
            </span>
          )}
          {file.action && (
            <span
              className={cn(
                'shrink-0 rounded px-1 text-[10px]',
                file.action === 'created' && 'bg-success/15 text-success',
                file.action === 'modified' && 'bg-warning/15 text-warning',
                file.action === 'deleted' && 'bg-destructive/15 text-destructive',
              )}
            >
              {file.action}
            </span>
          )}
          <CopyButton text={file.path} label={copyLabel} />
        </div>
      ))}
    </div>
  );
}

/**
 * File list visualization. Small lists render inline; lists above the inline
 * budget collapse to a single header row (count + pattern) that expands on
 * demand, so a 100-file glob no longer consumes the transcript.
 */
export function FileListViewer({
  title,
  groups,
  files,
  total,
  singularLabel,
  pluralLabel,
}: FileListViewerProps) {
  const [expanded, setExpanded] = useState(false);

  const singular = singularLabel ?? 'file';
  const plural = pluralLabel ?? 'files';
  const copyLabel = singularLabel ?? 'path';

  const displayGroups = useMemo(
    () => groups ?? (files ? [{ label: plural, files }] : []),
    [groups, files, plural],
  );

  const totalItemCount = displayGroups.reduce((sum, g) => sum + g.files.length, 0);

  const visibleGroups = useMemo(() => {
    if (totalItemCount <= RENDER_BUDGETS.fileListMaxItems) return displayGroups;
    let remaining = RENDER_BUDGETS.fileListMaxItems;
    return displayGroups.map((group) => {
      if (remaining <= 0) return { ...group, files: [] };
      const slice = group.files.slice(0, remaining);
      remaining -= slice.length;
      return { ...group, files: slice };
    });
  }, [displayGroups, totalItemCount]);

  if (displayGroups.length === 0) {
    return null;
  }

  const reportedTotal = total ?? totalItemCount;
  const serverTruncated = reportedTotal > totalItemCount;
  const countText = `${reportedTotal} ${reportedTotal === 1 ? singular : plural}`;
  const showGroupHeaders = groups !== undefined;

  const renderGroups = () => (
    <div className="flex flex-col gap-2">
      {visibleGroups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-1">
          {showGroupHeaders && (
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.icon && (() => {
                const Icon = iconMap[group.icon];
                return <Icon className="size-3" />;
              })()}
              <span>{group.label}</span>
              <span className="tabular-nums opacity-70">{group.files.length}</span>
            </div>
          )}
          <FileRows files={group.files} copyLabel={copyLabel} />
        </div>
      ))}
    </div>
  );

  // Small list: render inline, no toggle.
  if (totalItemCount <= RENDER_BUDGETS.fileListInlineMaxItems) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 tabular-nums text-muted-foreground">{countText}</span>
          {title && (
            <span className="min-w-0 truncate font-mono text-muted-foreground/70">{title}</span>
          )}
        </div>
        {renderGroups()}
      </div>
    );
  }

  // Large list: collapsed header row, expand on demand.
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/70"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="shrink-0 text-xs font-medium tabular-nums text-foreground/80">
          {countText}
        </span>
        {title && (
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground/70">
            {title}
          </span>
        )}
        {serverTruncated && (
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
            first {totalItemCount} shown
          </span>
        )}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 px-2.5 py-2">
          {renderGroups()}
          {serverTruncated && (
            <div className="text-[10px] italic tabular-nums text-muted-foreground/60">
              Showing first {totalItemCount} of {reportedTotal}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
