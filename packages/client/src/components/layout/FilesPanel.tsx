import { forwardRef, useCallback, useImperativeHandle, useRef, useState, useEffect, useMemo } from 'react';
import { ArrowLeft, RefreshCw, Search, ChevronDown, ChevronRight, Folder, File, Check } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import type { FileEntry, ProkopaiClient } from '@prokopai/sdk';
import { FileTree, type FileTreeHandle, GitChangesView, type GitChangesViewHandle } from '@/components/files';
import { FileEntryContextMenu, type FileEntryActions, type FileEntryActionTarget } from '@/components/files/FileEntryContextMenu';
import { FOLDER_ICON_COLOR, fileIconColor } from '@/components/files/fileIcons';
import { buildFilePathTree, type FilePathDirectoryNode } from '@/components/files/filePathTree';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Sidebar,
  SidebarContent,
  SidebarProvider,
  PanelResizeHandle,
} from '@/components/ui/sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useUIStore, type DefaultFileOpenMode } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { useFileSearchQuery } from '@/hooks/queries';
import { queryKeys } from '@/lib/queryKeys';

interface FilesPanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
  embeddedWidth?: number;
}

export interface FilesPanelHandle {
  focus: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;

function pathBasename(p: string): string {
  const trimmed = p.replace(/\/+$/, '');
  const slashIdx = trimmed.lastIndexOf('/');
  return slashIdx === -1 ? trimmed : trimmed.slice(slashIdx + 1);
}

function PathSwitcher({
  workspace,
  selectedRoot,
  onSelect,
}: {
  workspace: { name: string; path: string; additionalPaths: string[] };
  selectedRoot: string;
  onSelect: (root: string) => void;
}) {
  const options = [
    { label: workspace.name || pathBasename(workspace.path) || 'Workspace', value: workspace.path },
    ...workspace.additionalPaths.map((p) => ({ label: pathBasename(p) || p, value: p })),
  ];
  const selectedLabel = options.find((o) => o.value === selectedRoot)?.label ?? options[0].label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 max-w-full gap-1.5 px-2 font-semibold hover:bg-accent"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Folder className={cn('size-4 shrink-0', FOLDER_ICON_COLOR)} />
            <span className="truncate">{selectedLabel}</span>
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[12rem] max-w-[18rem]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => onSelect(opt.value)}
            className="gap-2"
          >
            <Folder className={cn('size-3.5 shrink-0', FOLDER_ICON_COLOR)} />
            <span className="truncate">{opt.label}</span>
            {opt.value === selectedRoot && <Check className="size-3.5 ml-auto shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchResultFileRow({
  file,
  depth,
  root,
  onFileSelect,
  contextActions,
}: {
  file: FileEntry;
  depth: number;
  root: string | undefined;
  onFileSelect: (target: FileEntryActionTarget) => void;
  contextActions?: FileEntryActions;
}) {
  const button = (
    <button
      data-file-node
      data-file-type="file"
      onClick={() => onFileSelect({ entry: file, root })}
      className={cn(
        'flex items-center gap-2 w-full min-w-0 overflow-hidden rounded-md p-2 text-left text-sm',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus:ring-1 focus:ring-inset ring-sidebar-ring outline-hidden',
        '[&_svg]:size-4 [&_svg]:shrink-0',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="size-3 shrink-0" aria-hidden />
      <File className={fileIconColor(file.path)} />
      <span className="truncate flex-1 min-w-0">{file.name}</span>
    </button>
  );

  if (!contextActions) return button;

  return (
    <FileEntryContextMenu target={{ entry: file, root }} actions={contextActions}>
      {button}
    </FileEntryContextMenu>
  );
}

function SearchResultDirectory({
  node,
  depth,
  root,
  onFileSelect,
  contextActions,
}: {
  node: FilePathDirectoryNode<FileEntry>;
  depth: number;
  root: string | undefined;
  onFileSelect: (target: FileEntryActionTarget) => void;
  contextActions?: FileEntryActions;
}) {
  const [open, setOpen] = useState(true);

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
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <Folder className={FOLDER_ICON_COLOR} />
          <span className="truncate flex-1 min-w-0">{node.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">{node.fileCount}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-0.5">
          {node.directories.map((directory) => (
            <SearchResultDirectory
              key={directory.path}
              node={directory}
              depth={depth + 1}
              root={root}
              onFileSelect={onFileSelect}
              contextActions={contextActions}
            />
          ))}
          {node.files.map((file) => (
            <SearchResultFileRow
              key={file.path}
              file={file}
              depth={depth + 1}
              root={root}
              onFileSelect={onFileSelect}
              contextActions={contextActions}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SearchResults({
  workspaceId,
  sdkClient,
  query,
  root,
  onFileSelect,
  contextActions,
}: {
  workspaceId: string;
  sdkClient: ProkopaiClient | null;
  query: string;
  root: string | undefined;
  onFileSelect: (target: FileEntryActionTarget) => void;
  contextActions?: FileEntryActions;
}) {
  const normalizedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedQuery);

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setDebouncedQuery('');
      return;
    }

    const timer = window.setTimeout(() => {
      setDebouncedQuery(normalizedQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [normalizedQuery]);

  const effectiveQuery = normalizedQuery.length >= 2 ? debouncedQuery : '';
  const { data, isFetching, error } = useFileSearchQuery(
    sdkClient,
    workspaceId,
    effectiveQuery,
    root,
  );
  const fileResults = useMemo(
    () => (data?.files ?? []).filter((entry) => entry.type === 'file'),
    [data?.files],
  );
  const resultTree = useMemo(() => buildFilePathTree(fileResults), [fileResults]);
  const loading = normalizedQuery.length >= 2 && (
    effectiveQuery !== normalizedQuery || isFetching
  );

  if (!query || query.length < 2) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Type at least 2 characters to search files...
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" />
        Searching...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-xs text-destructive">
        {error instanceof Error ? error.message : 'File search failed'}
      </div>
    );
  }

  if (fileResults.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        No files found matching &quot;{query}&quot;
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {resultTree.directories.map((directory) => (
          <SearchResultDirectory
            key={`${effectiveQuery}:${directory.path}`}
            node={directory}
            depth={0}
            root={root}
            onFileSelect={onFileSelect}
            contextActions={contextActions}
          />
        ))}
        {resultTree.files.map((file) => (
          <SearchResultFileRow
            key={file.path}
            file={file}
            depth={0}
            root={root}
            onFileSelect={onFileSelect}
            contextActions={contextActions}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

export const FilesPanel = forwardRef<FilesPanelHandle, FilesPanelProps>(
  ({ sdkClient, embedded = false, embeddedWidth }, ref) => {
    const isMobile = useIsMobile();
    const fileTreeRef = useRef<FileTreeHandle>(null);
    const gitChangesRef = useRef<GitChangesViewHandle>(null);
    const filesPanelWidth = useChatLayoutStore((s) => s.filesPanelWidth);
    const showFilesPanel = useChatLayoutStore((s) => s.showFilesPanel);
    const setShowFilesPanel = useChatLayoutStore((s) => s.setShowFilesPanel);
    const filesPanelTab = useChatLayoutStore((s) => s.filesPanelTab);
    const setFilesPanelTab = useChatLayoutStore((s) => s.setFilesPanelTab);
    const filesPanelRoot = useChatLayoutStore((s) => s.filesPanelRoot);
    const setFilesPanelRoot = useChatLayoutStore((s) => s.setFilesPanelRoot);
    const filesPanelGitMode = useChatLayoutStore((s) => s.filesPanelGitMode);
    const setFilesPanelGitMode = useChatLayoutStore((s) => s.setFilesPanelGitMode);
    const setWorkbenchSurface = useChatLayoutStore((s) => s.setWorkbenchSurface);
    const setMobileSurface = useChatLayoutStore((s) => s.setMobileSurface);
    const contentWidth = isMobile ? undefined : (embeddedWidth ?? filesPanelWidth);
    const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
    const workspaceId = activeWorkspace?.id;
    const routeParams = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
    const serverId = routeParams?.serverId as string | undefined;
    const [projectSearchQuery, setProjectSearchQuery] = useState('');
    const [changesSearchQuery, setChangesSearchQuery] = useState('');

    // Active editor doc (for highlighting the open file in the tree).
    const activeEditorPath = useFileEditorStore((s) => {
      if (!s.activeDocId) return undefined;
      const d = s.docs[s.activeDocId];
      if (!d) return undefined;
      if (d.identity.serverId !== (serverId ?? '') || d.identity.workspaceId !== (workspaceId ?? '')) return undefined;
      return d.identity.path;
    });
    const activeEditorRoot = useFileEditorStore((s) => {
      if (!s.activeDocId) return undefined;
      const d = s.docs[s.activeDocId];
      if (!d) return undefined;
      if (d.identity.serverId !== (serverId ?? '') || d.identity.workspaceId !== (workspaceId ?? '')) return undefined;
      return d.identity.root ?? '';
    });

    // Resolve the effective selected root (fall back to workspace.path).
    const selectedRoot = filesPanelRoot ?? activeWorkspace?.path ?? '';
    const isMainRoot = selectedRoot === activeWorkspace?.path;

    // Reset stale root when the active workspace changes.
    useEffect(() => {
      if (!activeWorkspace) return;
      if (filesPanelRoot && filesPanelRoot !== activeWorkspace.path && !activeWorkspace.additionalPaths.includes(filesPanelRoot)) {
        setFilesPanelRoot(null);
      }
    }, [activeWorkspace, filesPanelRoot, setFilesPanelRoot]);

    // Clear search query when the workspace changes to avoid running
    // the previous workspace's search against the new workspace.
    const workspaceIdForReset = activeWorkspace?.id;
    useEffect(() => {
      setProjectSearchQuery('');
      setChangesSearchQuery('');
    }, [workspaceIdForReset]);

    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = useCallback(() => {
      setIsRefreshing(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.files.browsePrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.searchPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.browseFsPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.parentPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.drivesPrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.gitStatusPrefix });

      if (sdkClient && workspaceId) {
        void sdkClient.http.workspaces
          .get(workspaceId)
          .then(({ workspace: updatedWorkspace }) => {
            const store = useServerDataStore.getState();
            store.setWorkspaces(
              store.workspaces.map((w) => (w.id === updatedWorkspace.id ? updatedWorkspace : w)),
            );
            if (store.activeWorkspace?.id === updatedWorkspace.id) {
              store.setActiveWorkspace(updatedWorkspace);
            }
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error('Failed to refresh workspace:', message);
          })
          .finally(() => setIsRefreshing(false));
      } else {
        setIsRefreshing(false);
      }
    }, [sdkClient, workspaceId]);

    const focus = useCallback(() => {
      const focusActiveView = () => {
        if (filesPanelTab === 'changes') {
          gitChangesRef.current?.focus();
        } else {
          fileTreeRef.current?.focus();
        }
      };

      if (isMobile) {
        setMobileSurface('files');
      } else {
        setWorkbenchSurface(filesPanelTab === 'changes' ? 'changes' : 'explorer');
        setShowFilesPanel(true);
      }
      requestAnimationFrame(() => requestAnimationFrame(focusActiveView));
      window.setTimeout(focusActiveView, 250);
    }, [filesPanelTab, isMobile, setMobileSurface, setShowFilesPanel, setWorkbenchSurface]);

    useImperativeHandle(ref, () => ({ focus }), [focus]);

    const openFilePreview = useUIStore((s) => s.openFilePreview);
    const defaultFileOpenMode = useUIStore((s) => s.defaultFileOpenMode);

    // Centralized mode-aware file opener.
    // Preview opens the read-only FilePreviewOverlay.
    // Edit opens or focuses the persistent editor document.
    const openFile = useCallback((target: FileEntryActionTarget, mode?: DefaultFileOpenMode) => {
      const { entry, root } = target;
      if (entry.type !== 'file') return;
      if (entry.git?.status === 'deleted' && mode === 'edit') return;

      const effectiveMode = entry.git?.status === 'deleted'
        ? 'preview'
        : mode ?? defaultFileOpenMode;

      if (workspaceId) {
        if (effectiveMode === 'preview') {
          openFilePreview({
            workspaceId,
            path: entry.path,
            name: entry.name,
            root,
          });
          return;
        }

        if (serverId) {
          useFileEditorStore.getState().openDoc(
            {
              serverId,
              workspaceId,
              root: root ?? '',
              path: entry.path,
            },
            entry.name,
          );
          if (isMobile) {
            setMobileSurface('editor');
          } else {
            setWorkbenchSurface('editor');
            setShowFilesPanel(true);
          }
          return;
        }
      }
    }, [workspaceId, serverId, isMobile, setMobileSurface, setShowFilesPanel, setWorkbenchSurface, openFilePreview, defaultFileOpenMode]);

    const handleFileSelect = useCallback((target: FileEntryActionTarget) => {
      openFile(target);
    }, [openFile]);

    const contextActions: FileEntryActions = useMemo(() => ({
      open: openFile,
    }), [openFile]);

    const headerContent = activeWorkspace ? (
      <div className="flex flex-col gap-2 px-2 pt-2 pb-2">
        <div className="flex items-center gap-1.5">
          <PathSwitcher
            workspace={activeWorkspace}
            selectedRoot={selectedRoot}
            onSelect={setFilesPanelRoot}
          />
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="ml-auto shrink-0"
            aria-label="Refresh files"
          >
            <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
          </Button>
          {isMobile && !embedded && (
            <Button variant="ghost" size="sm" onClick={() => setMobileSurface('chat')} className="shrink-0">
              <ArrowLeft className="size-4" />
              Chat
            </Button>
          )}
        </div>
        {!embedded && (
          <Tabs value={filesPanelTab} onValueChange={(v) => setFilesPanelTab(v as 'project' | 'changes')}>
            <TabsList className="w-full">
              <TabsTrigger value="project" className="flex-1">Project</TabsTrigger>
              <TabsTrigger value="changes" className="flex-1">Changes</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {filesPanelTab === 'project' && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={projectSearchQuery}
              onChange={(e) => setProjectSearchQuery(e.target.value)}
              placeholder="Search files..."
              className="h-7 pl-7 pr-2 text-sm"
            />
          </div>
        )}
        {filesPanelTab === 'changes' && (
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={changesSearchQuery}
                onChange={(e) => setChangesSearchQuery(e.target.value)}
                placeholder="Search changes..."
                className="h-7 pl-7 pr-2 text-sm"
              />
            </div>
            <div className="flex shrink-0 items-center rounded-lg bg-muted p-0.5">
              {([
                ['grouped', 'Grouped'],
                ['flat', 'Flat'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filesPanelGitMode === value}
                  onClick={() => setFilesPanelGitMode(value)}
                  className={cn(
                    'flex h-6 items-center rounded-md px-2 text-[11px] font-medium transition-colors',
                    filesPanelGitMode === value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null;

    const content = workspaceId ? (
      filesPanelTab === 'project' ? (
        projectSearchQuery.trim().length >= 2 ? (
          <SearchResults
            workspaceId={workspaceId}
            sdkClient={sdkClient}
            query={projectSearchQuery.trim()}
            root={isMainRoot ? undefined : selectedRoot}
            onFileSelect={handleFileSelect}
            contextActions={contextActions}
          />
        ) : (
          <FileTree
            ref={fileTreeRef}
            key={workspaceId + selectedRoot}
            workspaceId={workspaceId}
            sdkClient={sdkClient}
            showHidden={true}
            width={contentWidth}
            root={isMainRoot ? undefined : selectedRoot}
            onFileSelect={handleFileSelect}
            activePath={activeEditorPath}
            activeRoot={activeEditorRoot}
            contextActions={contextActions}
          />
        )
      ) : (
        <GitChangesView
          ref={gitChangesRef}
          workspaceId={workspaceId}
          sdkClient={sdkClient}
          root={isMainRoot ? undefined : selectedRoot}
          mode={filesPanelGitMode}
          searchQuery={changesSearchQuery}
          onFileSelect={handleFileSelect}
          width={contentWidth}
          contextActions={contextActions}
        />
      )
    ) : null;

    if (!workspaceId) {
      return null;
    }

    if (embedded) {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar" data-workbench-explorer>
          {headerContent}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {content}
          </div>
        </div>
      );
    }

    if (isMobile) {
      return (
        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar" data-workbench-explorer>
          {headerContent}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {content}
          </div>
        </div>
      );
    }

    return (
      <SidebarProvider
        panelId="files"
        defaultOpen={true}
        className="w-0 shrink-0"
        style={{ '--sidebar-width': `${filesPanelWidth}px` } as React.CSSProperties}
      >
        <Sidebar side="right" isOpen={showFilesPanel} variant="floating">
          <PanelResizeHandle side="right" panelId="files" />
          {headerContent}
          <SidebarContent className="overflow-hidden">
            {content}
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    );
  }
);

FilesPanel.displayName = 'FilesPanel';
