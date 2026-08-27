import { forwardRef, useCallback, useImperativeHandle, useRef, useState, useEffect } from 'react';
import { ArrowLeft, RefreshCw, Search, ChevronDown, Folder, Check } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileTree, type FileTreeHandle, GitChangesView, type GitChangesViewHandle } from '@/components/files';
import { type FileEntryActionTarget } from '@/components/files/FileEntryContextMenu';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
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
import { cn } from '@/lib/utils';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { useUIStore, type DefaultFileOpenMode } from '@/stores/uiStore';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';

interface FilesPanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
  embeddedWidth?: number;
}

export interface FilesPanelHandle {
  focus: () => void;
}

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

export const FilesPanel = forwardRef<FilesPanelHandle, FilesPanelProps>(
  ({ sdkClient, embedded = false, embeddedWidth: _embeddedWidth }, ref) => {
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
    const setWorkbenchSurface = useChatLayoutStore((s) => s.setWorkbenchSurface);
    const setMobileSurface = useChatLayoutStore((s) => s.setMobileSurface);
    const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
    const workspaceId = activeWorkspace?.id;
    const routeParams = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
    const serverId = routeParams?.serverId as string | undefined;
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

    // Clear the changes filter when the workspace changes. The Project tree's
    // built-in search session resets with its model (remounted per root).
    const workspaceIdForReset = activeWorkspace?.id;
    useEffect(() => {
      setChangesSearchQuery('');
    }, [workspaceIdForReset]);

    const [isRefreshing, setIsRefreshing] = useState(false);

    const handleRefresh = useCallback(() => {
      setIsRefreshing(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.files.browsePrefix });
      queryClient.invalidateQueries({ queryKey: queryKeys.files.treePrefix });
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
          </div>
        )}
      </div>
    ) : null;

    const content = workspaceId ? (
      filesPanelTab === 'project' ? (
        <FileTree
          ref={fileTreeRef}
          key={workspaceId + selectedRoot}
          workspaceId={workspaceId}
          sdkClient={sdkClient}
          root={isMainRoot ? undefined : selectedRoot}
          onFileSelect={handleFileSelect}
          activePath={activeEditorPath}
          activeRoot={activeEditorRoot}
        />
      ) : (
        <GitChangesView
          ref={gitChangesRef}
          workspaceId={workspaceId}
          sdkClient={sdkClient}
          root={isMainRoot ? undefined : selectedRoot}
          searchQuery={changesSearchQuery}
          onFileSelect={handleFileSelect}
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
