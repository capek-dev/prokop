import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Loader2, File, ChevronRight, Folder } from 'lucide-react';
import type { FileEntry, GitDiffSummary } from '@prokopai/sdk';
import type { ProkopaiClient } from '@prokopai/sdk';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useGitStatusQuery } from '@/hooks/queries';
import { GitStatusBadge } from './GitStatusBadge';
import {
  FileEntryContextMenu,
  type FileEntryActionTarget,
  type FileEntryActions,
} from './FileEntryContextMenu';
import { FOLDER_ICON_COLOR, fileIconColor } from './fileIcons';
import {
  buildFilePathTree,
  type FilePathDirectoryNode,
  type FilePathTree,
} from './filePathTree';

export interface GitChangesViewHandle {
  focus: () => void;
}

interface GitChangesViewProps {
  workspaceId: string;
  sdkClient: ProkopaiClient | null;
  root?: string;
  mode: 'grouped' | 'flat';
  searchQuery?: string;
  onFileSelect: (target: FileEntryActionTarget) => void;
  width?: number;
  contextActions?: FileEntryActions;
}

type ChangedFile = { path: string; git: GitDiffSummary };

// --- Tree model ---

export type ChangedDirectoryNode = FilePathDirectoryNode<ChangedFile>;
export type ChangedFilesTree = FilePathTree<ChangedFile>;

export function buildChangedFilesTree(files: ChangedFile[]): ChangedFilesTree {
  return buildFilePathTree(files);
}

// --- File row ---

function ChangedFileRow({
  path,
  git,
  onFileSelect,
  depth = 0,
  showChevronSpacer = false,
  showDirPrefix = true,
  contextActions,
  root,
}: {
  path: string;
  git: GitDiffSummary;
  onFileSelect: (target: FileEntryActionTarget) => void;
  depth?: number;
  showChevronSpacer?: boolean;
  showDirPrefix?: boolean;
  contextActions?: FileEntryActions;
  root?: string;
}) {
  const lastSlash = path.lastIndexOf('/');
  const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dirPath = lastSlash === -1 ? '' : path.slice(0, lastSlash + 1);

  const handleClick = () => {
    const extension = fileName.lastIndexOf('.') !== -1
      ? fileName.slice(fileName.lastIndexOf('.'))
      : undefined;
    onFileSelect({
      entry: { name: fileName, type: 'file', path, extension, git },
      root,
    });
  };

  const button = (
    <button
      data-file-node
      data-file-type="file"
      onClick={handleClick}
      className={cn(
        'flex items-center gap-2 w-full min-w-0 overflow-hidden rounded-md p-2 text-left text-sm',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus:ring-1 focus:ring-inset ring-sidebar-ring outline-hidden',
        '[&_svg]:size-4 [&_svg]:shrink-0',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      {showChevronSpacer && <span className="w-3 h-3 shrink-0" aria-hidden />}
      <File className={fileIconColor(path)} />
      <span className="truncate flex-1 min-w-0">
        {showDirPrefix && dirPath && <span className="text-muted-foreground">{dirPath}</span>}
        <span>{fileName}</span>
      </span>
      <GitStatusBadge git={git} />
    </button>
  );

  const entry: FileEntry = {
    name: fileName,
    type: 'file',
    path,
    extension: fileName.lastIndexOf('.') !== -1 ? fileName.slice(fileName.lastIndexOf('.')) : undefined,
    git,
  };

  if (contextActions) {
    return (
      <FileEntryContextMenu
        target={{ entry, root }}
        actions={contextActions}
      >
        {button}
      </FileEntryContextMenu>
    );
  }

  return button;
}

// --- Grouped mode ---

function GroupedChangedFiles({
  files,
  onFileSelect,
  contextActions,
  root,
  defaultExpanded,
}: {
  files: ChangedFile[];
  onFileSelect: (target: FileEntryActionTarget) => void;
  contextActions?: FileEntryActions;
  root?: string;
  defaultExpanded: boolean;
}) {
  const tree = useMemo(() => buildChangedFilesTree(files), [files]);

  return (
    <div className="space-y-0.5">
      {tree.directories.map((dir) => (
        <GroupedDirectoryNode key={dir.path} node={dir} depth={0} onFileSelect={onFileSelect} contextActions={contextActions} root={root} defaultExpanded={defaultExpanded} />
      ))}
      {tree.files.map((f) => (
        <ChangedFileRow
          key={f.path}
          path={f.path}
          git={f.git}
          depth={0}
          showChevronSpacer
          showDirPrefix={false}
          onFileSelect={onFileSelect}
          contextActions={contextActions}
          root={root}
        />
      ))}
    </div>
  );
}

function GroupedDirectoryNode({
  node,
  depth,
  onFileSelect,
  contextActions,
  root,
  defaultExpanded,
}: {
  node: ChangedDirectoryNode;
  depth: number;
  onFileSelect: (target: FileEntryActionTarget) => void;
  contextActions?: FileEntryActions;
  root?: string;
  defaultExpanded: boolean;
}) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          data-file-node
          data-file-type="directory"
          data-file-is-open={open || undefined}
          className={cn(
            'flex items-center gap-2 w-full min-w-0 overflow-hidden rounded-md p-2 text-left text-sm',
            'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            'focus:ring-1 focus:ring-inset ring-sidebar-ring outline-hidden',
            '[&_svg]:size-4 [&_svg]:shrink-0',
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <ChevronRight className={cn('w-3 h-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <Folder className={FOLDER_ICON_COLOR} />
          <span className="flex-1 min-w-0 truncate">{node.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{node.fileCount}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-0.5">
          {node.directories.map((child) => (
            <GroupedDirectoryNode key={child.path} node={child} depth={depth + 1} onFileSelect={onFileSelect} contextActions={contextActions} root={root} defaultExpanded={defaultExpanded} />
          ))}
          {node.files.map((f) => (
            <ChangedFileRow
              key={f.path}
              path={f.path}
              git={f.git}
              depth={depth + 1}
              showChevronSpacer
              showDirPrefix={false}
              onFileSelect={onFileSelect}
              contextActions={contextActions}
              root={root}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// --- Main component ---

const REASON_LABELS: Record<string, string> = {
  git_not_installed: 'Git is not installed',
  not_a_git_repo: 'Not a git repository',
  git_error: 'Unable to read git status',
};

export const GitChangesView = forwardRef<GitChangesViewHandle, GitChangesViewProps>(
  ({ workspaceId, sdkClient, root, mode, searchQuery = '', onFileSelect, width, contextActions }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { data, isLoading, error } = useGitStatusQuery(sdkClient, workspaceId, root);

    const focus = useCallback(() => {
      const container = containerRef.current;
      if (container) {
        const firstNode = container.querySelector<HTMLButtonElement>('[data-file-node]');
        if (firstNode) {
          firstNode.focus();
        } else {
          container.focus();
        }
      }
    }, []);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    if (isLoading) {
      return (
        <div ref={containerRef} className="flex items-center justify-center h-32 text-muted-foreground" tabIndex={-1}>
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          Loading changes...
        </div>
      );
    }

    if (error) {
      return (
        <div ref={containerRef} className="p-4 text-sm text-destructive" tabIndex={-1}>{error.message}</div>
      );
    }

    const availability = data?.availability;
    const files = data?.files ?? [];
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    const filteredFiles = normalizedSearchQuery
      ? files.filter((file) => file.path.toLowerCase().includes(normalizedSearchQuery))
      : files;

    if (availability && !availability.available) {
      const label = availability.reason ? REASON_LABELS[availability.reason] ?? 'Git unavailable' : 'Git unavailable';
      return (
        <div ref={containerRef} className="p-4 text-sm text-muted-foreground text-center" tabIndex={-1}>{label}</div>
      );
    }

    if (files.length === 0) {
      return (
        <div ref={containerRef} className="p-4 text-sm text-muted-foreground text-center" tabIndex={-1}>No changes</div>
      );
    }

    if (filteredFiles.length === 0) {
      return (
        <div ref={containerRef} className="p-4 text-sm text-muted-foreground text-center" tabIndex={-1}>No matching files</div>
      );
    }

    return (
      <div ref={containerRef} className="flex-1 min-h-0 min-w-0 w-full outline-none" tabIndex={-1}>
        <ScrollArea className="h-full">
          <div className="px-2 pb-2 w-full min-w-0" style={width ? { width: `${width - 8}px` } : undefined}>
            {mode === 'grouped' ? (
              <GroupedChangedFiles key={normalizedSearchQuery ? 'search' : 'browse'} files={filteredFiles} onFileSelect={onFileSelect} contextActions={contextActions} root={root} defaultExpanded={normalizedSearchQuery.length > 0} />
            ) : (
              <div className="space-y-0.5">
                {filteredFiles.map((f) => (
                  <ChangedFileRow key={f.path} path={f.path} git={f.git} onFileSelect={onFileSelect} contextActions={contextActions} root={root} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  }
);

GitChangesView.displayName = 'GitChangesView';
