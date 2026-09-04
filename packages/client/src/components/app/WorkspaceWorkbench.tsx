import type { RefObject } from 'react';
import { ArrowLeft, Code2, FolderTree, GitBranch, GitFork } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileEditorSurface } from '@/components/editor/FileEditorSurface';
import { FilesPanel, type FilesPanelHandle } from '@/components/layout/FilesPanel';
import { Button } from '@/components/ui/button';
import { useWorktreesQuery } from '@/hooks/queries';
import { hasOpenDocsForScope, useFileEditorStore } from '@/stores/fileEditorStore';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { cn } from '@/lib/utils';

interface WorkspaceWorkbenchProps {
  sdkClient: ProkopaiClient | null;
  serverId: string;
  workspaceId: string;
  width: number;
  filesPanelRef: RefObject<FilesPanelHandle | null>;
  onClose: () => void;
  mobile?: boolean;
}

export function WorkspaceWorkbench({
  sdkClient,
  serverId,
  workspaceId,
  width,
  filesPanelRef,
  onClose,
  mobile = false,
}: WorkspaceWorkbenchProps) {
  const surface = useChatLayoutStore((state) => state.workbenchSurface);
  const setSurface = useChatLayoutStore((state) => state.setWorkbenchSurface);
  const filesPanelTab = useChatLayoutStore((state) => state.filesPanelTab);
  const setFilesPanelTab = useChatLayoutStore((state) => state.setFilesPanelTab);
  const mobileSurface = useChatLayoutStore((state) => state.mobileSurface);
  const setMobileSurface = useChatLayoutStore((state) => state.setMobileSurface);
  const openDocCount = useFileEditorStore((state) => state.openDocIds.length);
  const hasEditorDocs = openDocCount > 0 && hasOpenDocsForScope(serverId, workspaceId);
  const { data: worktreesData } = useWorktreesQuery(sdkClient, workspaceId);
  const hasWorktrees = (worktreesData ?? []).length > 0;

  const activeSurface = mobile
    ? mobileSurface === 'editor' && hasEditorDocs
      ? 'editor'
      : filesPanelTab === 'changes'
        ? 'changes'
        : filesPanelTab === 'worktrees'
          ? 'worktrees'
          : 'explorer'
    : surface === 'editor' && !hasEditorDocs
      ? 'explorer'
      : surface;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar md:rounded-xl md:border md:border-border/50"
      aria-label="Workspace workbench"
      data-workspace-workbench
    >
      <div className="flex h-10 shrink-0 items-center gap-1 px-1" role="tablist">
        {mobile && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Back to Chat"
          >
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="flex items-center rounded-lg bg-muted p-0.5">
          <button
            type="button"
            role="tab"
            aria-selected={activeSurface === 'explorer'}
            onClick={() => {
              setFilesPanelTab('project');
              setSurface('explorer');
              if (mobile) setMobileSurface('files');
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              activeSurface === 'explorer'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <FolderTree className="size-3.5" />
            Explorer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeSurface === 'changes'}
            onClick={() => {
              setFilesPanelTab('changes');
              setSurface('changes');
              if (mobile) setMobileSurface('files');
            }}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              activeSurface === 'changes'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <GitBranch className="size-3.5" />
            Changes
          </button>
          {hasWorktrees && (
            <button
              type="button"
              role="tab"
              aria-selected={activeSurface === 'worktrees'}
              onClick={() => {
                setFilesPanelTab('worktrees');
                setSurface('worktrees');
                if (mobile) setMobileSurface('files');
              }}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                activeSurface === 'worktrees'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <GitFork className="size-3.5" />
              Worktrees
            </button>
          )}
          {hasEditorDocs && (
            <button
              type="button"
              role="tab"
              aria-selected={activeSurface === 'editor'}
              onClick={() => {
                setSurface('editor');
                if (mobile) setMobileSurface('editor');
              }}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                activeSurface === 'editor'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Code2 className="size-3.5" />
              Editor
            </button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          role="tabpanel"
          className={cn('absolute inset-0', activeSurface === 'editor' && 'invisible pointer-events-none')}
          aria-hidden={activeSurface === 'editor'}
        >
          <FilesPanel
            ref={filesPanelRef}
            sdkClient={sdkClient}
            embedded
            embeddedWidth={Math.min(width, 512)}
          />
        </div>
        {hasEditorDocs && (
          <div
            role="tabpanel"
            className={cn('absolute inset-0', activeSurface !== 'editor' && 'invisible pointer-events-none')}
            aria-hidden={activeSurface !== 'editor'}
          >
            <FileEditorSurface
              sdkClient={sdkClient}
              serverId={serverId}
              workspaceId={workspaceId}
            />
          </div>
        )}
      </div>
    </section>
  );
}
