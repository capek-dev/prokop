import { forwardRef, useCallback, useImperativeHandle, useRef, useState, useEffect, useMemo } from 'react';
import { ArrowLeft, RefreshCw, ChevronDown, Folder, GitBranch, Check, PinOff, Plus, FilePlus2, FolderPlus } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileTree, type FileTreeHandle, GitChangesView, type GitChangesViewHandle } from '@/components/files';
import { type FileEntryActionTarget } from '@/components/files/FileEntryContextMenu';
import { FOLDER_ICON_COLOR } from '@/components/files/fileIcons';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGitStatusQuery } from '@/hooks/queries/useFileQueries';
import { useWorktreeMutations, useWorktreesQuery } from '@/hooks/queries';
import { summarizeDiffStats } from '@/components/files/GitChangesView';
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
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useFileEditorStore } from '@/stores/fileEditorStore';
import { queryClient } from '@/components/providers/QueryProvider';
import { queryKeys } from '@/lib/queryKeys';
import { buildFilesPanelRootOptions, resolveFilesPanelRoot } from '@/lib/sessionWorktree';
import { WorktreesPanel } from '@/components/worktrees/WorktreesPanel';
import { CheckoutMenu } from '@/components/worktrees/SessionCheckoutSelector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface FilesPanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
  embeddedWidth?: number;
}

export interface FilesPanelHandle {
  focus: () => void;
}

function PathSwitcher({
  options,
  selectedRoot,
  onSelect,
}: {
  options: Array<{ label: string; value: string }>;
  selectedRoot: string;
  onSelect: (root: string) => void;
}) {
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
    const filesPanelRootPinned = useChatLayoutStore((s) => s.filesPanelRootPinned);
    const setFilesPanelRoot = useChatLayoutStore((s) => s.setFilesPanelRoot);
    const setFilesPanelRootPinned = useChatLayoutStore((s) => s.setFilesPanelRootPinned);
    const setWorkbenchSurface = useChatLayoutStore((s) => s.setWorkbenchSurface);
    const setMobileSurface = useChatLayoutStore((s) => s.setMobileSurface);
    const activeWorkspace = useServerDataStore((s) => s.activeWorkspace);
    const workspaceId = activeWorkspace?.id;
    const focusedSessionId = useSessionBoardStore((s) => s.focusedSessionId);
    const focusedSession = useSessionStore((s) => (
      s.sessions.find((session) => session.id === focusedSessionId) ?? null
    ));
    const worktrees = useWorktreesQuery(sdkClient, workspaceId);
    const worktreeMutations = useWorktreeMutations(sdkClient, workspaceId);
    const sessionWorktree = worktrees.data?.find((worktree) => (
      worktree.id === focusedSession?.workspaceRootId
    )) ?? focusedSession?.worktree;
    const managedRoots = useMemo(
      () => (worktrees.data ?? [])
        .filter((worktree) => worktree.state === 'available')
        .map((worktree) => worktree.path),
      [worktrees.data],
    );
    const rootOptions = useMemo(
      () => activeWorkspace
        ? buildFilesPanelRootOptions(activeWorkspace, worktrees.data ?? [])
        : [],
      [activeWorkspace, worktrees.data],
    );
    const routeParams = useParams({ from: '/server/$serverId', strict: false } as unknown as Parameters<typeof useParams>[0]);
    const serverId = routeParams?.serverId as string | undefined;

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

    // Follow the focused session unless the user pinned a root manually.
    const rootResolution = resolveFilesPanelRoot({
      workspacePath: activeWorkspace?.path ?? '',
      workspaceRootId: focusedSession?.workspaceRootId,
      worktree: sessionWorktree,
      pinnedRoot: filesPanelRoot,
      pinned: filesPanelRootPinned,
    });
    const selectedRoot = rootResolution.selectedRoot;
    const isMainRoot = rootResolution.isPrimary;
    const rootBlocked = rootResolution.blocked;

    // Reset stale root when the active workspace changes.
    useEffect(() => {
      if (!activeWorkspace) return;
      const allowedRoots = [...activeWorkspace.additionalPaths, ...managedRoots];
      if (filesPanelRoot && filesPanelRoot !== activeWorkspace.path && !allowedRoots.includes(filesPanelRoot)) {
        setFilesPanelRoot(null);
        setFilesPanelRootPinned(false);
      }
    }, [activeWorkspace, filesPanelRoot, managedRoots, setFilesPanelRoot, setFilesPanelRootPinned]);

    const [isRefreshing, setIsRefreshing] = useState(false);
    const [rootRecoveryError, setRootRecoveryError] = useState<string | null>(null);
    const [recoverySwitchOpen, setRecoverySwitchOpen] = useState(false);

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

    // When the last worktree disappears, the tab hides; leave the stored tab
    // on a surface that still renders.
    useEffect(() => {
      if (filesPanelTab === 'worktrees' && !worktrees.isLoading && (worktrees.data ?? []).length === 0) {
        setFilesPanelTab('project');
        setWorkbenchSurface('explorer');
      }
    }, [filesPanelTab, worktrees.isLoading, worktrees.data, setFilesPanelTab, setWorkbenchSurface]);

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
        setWorkbenchSurface(filesPanelTab === 'changes' || filesPanelTab === 'worktrees' ? filesPanelTab : 'explorer');
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

    const handleFileSelect = useCallback((target: FileEntryActionTarget, mode?: DefaultFileOpenMode) => {
      openFile(target, mode);
    }, [openFile]);

    // Changes-tab stats in the header row. Reads the same git-status cache
    // as GitChangesView (shared query key), so no extra request.
    const isChangesTab = !embedded && filesPanelTab === 'changes';
    // The worktrees tab manages bindings and is workspace-scoped: a dead
    // session binding must not block it (Project and Changes stay
    // fail-closed), and the root-switcher header row is hidden entirely.
    const isWorktreesTab = filesPanelTab === 'worktrees';
    const changesRoot = isMainRoot ? undefined : selectedRoot;
    const gitStatusQuery = useGitStatusQuery(
      sdkClient,
      isChangesTab ? workspaceId : undefined,
      changesRoot,
      isChangesTab,
    );
    const changesStats = useMemo(
      () => summarizeDiffStats(gitStatusQuery.data?.files ?? []),
      [gitStatusQuery.data?.files],
    );

    const headerContent = activeWorkspace && !(embedded && isWorktreesTab) ? (
      <div className="flex flex-col gap-2 px-2 pt-2 pb-2">
        {!isWorktreesTab && (
        <div className="flex items-center gap-1.5">
          {rootBlocked ? (
            <div className="flex min-w-0 items-center gap-1.5 px-2 text-sm font-semibold text-destructive">
              <GitBranch className="size-4 shrink-0" />
              <span className="truncate">Worktree unavailable</span>
            </div>
          ) : (
            <PathSwitcher
              options={rootOptions}
              selectedRoot={selectedRoot}
              onSelect={(root) => {
                setFilesPanelRoot(root);
                setFilesPanelRootPinned(true);
              }}
            />
          )}
          {filesPanelRootPinned && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setFilesPanelRoot(null);
                setFilesPanelRootPinned(false);
              }}
              aria-label="Follow focused session"
              title="Follow focused session"
            >
              <PinOff />
            </Button>
          )}
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
          {filesPanelTab === 'project' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="shrink-0" aria-label="New file or folder">
                  <Plus className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => fileTreeRef.current?.openCreateAtRoot('file')}>
                  <FilePlus2 className="size-4" />
                  New File…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => fileTreeRef.current?.openCreateAtRoot('directory')}>
                  <FolderPlus className="size-4" />
                  New Folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isChangesTab && (gitStatusQuery.data || changesStats.fileCount > 0) && (
            <span
              className="flex shrink-0 items-center gap-1 text-[10px] tabular-nums text-muted-foreground/70"
              title={`${changesStats.fileCount} changed ${changesStats.fileCount === 1 ? 'file' : 'files'}${changesStats.hasCounts ? `, +${changesStats.additions} −${changesStats.deletions}` : ''}`}
            >
              <span>{changesStats.fileCount}</span>
              {changesStats.hasCounts && (
                <>
                  <span className="text-success">+{changesStats.additions}</span>
                  <span className="text-destructive/80">−{changesStats.deletions}</span>
                </>
              )}
            </span>
          )}
          {isMobile && !embedded && (
            <Button variant="ghost" size="sm" onClick={() => setMobileSurface('chat')} className="shrink-0">
              <ArrowLeft className="size-4" />
              Chat
            </Button>
          )}
        </div>
        )}
        {!embedded && (
          <Tabs value={filesPanelTab} onValueChange={(v) => setFilesPanelTab(v as 'project' | 'changes' | 'worktrees')}>
            <TabsList className="w-full">
              <TabsTrigger value="project" className="flex-1">Project</TabsTrigger>
              <TabsTrigger value="changes" className="flex-1">Changes</TabsTrigger>
              {(worktrees.data ?? []).length > 0 && (
                <TabsTrigger value="worktrees" className="flex-1">Worktrees</TabsTrigger>
              )}
            </TabsList>
          </Tabs>
        )}
      </div>
    ) : null;

    const content = workspaceId && rootBlocked && !isWorktreesTab ? (
      <div className="p-3">
        <Alert variant="destructive">
          <GitBranch />
          <AlertTitle>This session's worktree is unavailable</AlertTitle>
          <AlertDescription>
            <p>
              Files and Changes are blocked so Prokop does not silently use the primary checkout.
            </p>
            {rootRecoveryError && <p>{rootRecoveryError}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!focusedSession || worktreeMutations.unbind.isPending}
                onClick={() => {
                  if (!focusedSession) return;
                  setRootRecoveryError(null);
                  worktreeMutations.unbind.mutate(focusedSession.id, {
                    onError: (error) => setRootRecoveryError(
                      error instanceof Error ? error.message : String(error),
                    ),
                  });
                }}
              >
                Use primary checkout
              </Button>
              {focusedSession && (
                <Popover open={recoverySwitchOpen} onOpenChange={setRecoverySwitchOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={worktreeMutations.bind.isPending}
                    >
                      Switch worktree
                      <ChevronDown className="size-3.5 opacity-50" data-icon="inline-end" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="start">
                    <CheckoutMenu
                      session={focusedSession}
                      sdkClient={sdkClient}
                      onClose={() => setRecoverySwitchOpen(false)}
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </AlertDescription>
        </Alert>
      </div>
    ) : workspaceId ? (
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
          serverId={serverId}
          isMobile={isMobile}
          onOpenFileEdit={(path, name) =>
            openFile({ entry: { name, type: 'file', path }, root: isMainRoot ? undefined : selectedRoot }, 'edit')
          }
        />
      ) : filesPanelTab === 'worktrees' ? (
        <WorktreesPanel sdkClient={sdkClient} workspaceId={workspaceId} />
      ) : (
        <GitChangesView
          ref={gitChangesRef}
          workspaceId={workspaceId}
          sdkClient={sdkClient}
          root={isMainRoot ? undefined : selectedRoot}
          onFileSelect={handleFileSelect}
          serverId={serverId}
          isMobile={isMobile}
          onOpenFileEdit={(path, name) =>
            openFile({ entry: { name, type: 'file', path }, root: isMainRoot ? undefined : selectedRoot }, 'edit')
          }
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
