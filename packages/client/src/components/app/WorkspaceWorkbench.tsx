import type { RefObject } from 'react';
import { ArrowLeft, Code2, FolderTree, GitBranch } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { FileEditorSurface } from '@/components/editor/FileEditorSurface';
import { FilesPanel, type FilesPanelHandle } from '@/components/layout/FilesPanel';
import { Button } from '@/components/ui/button';
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

  const activeSurface = mobile
    ? mobileSurface === 'editor' && hasEditorDocs
      ? 'editor'
      : filesPanelTab === 'changes'
        ? 'changes'
        : 'explorer'
    : surface === 'editor' && !hasEditorDocs
      ? 'explorer'
      : surface;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background"
      aria-label="Workspace workbench"
      data-workspace-workbench
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-1" role="tablist">
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
        <Button
          type="button"
          role="tab"
          aria-selected={activeSurface === 'explorer'}
          variant={activeSurface === 'explorer' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => {
            setFilesPanelTab('project');
            setSurface('explorer');
            if (mobile) setMobileSurface('files');
          }}
        >
          <FolderTree className="size-3.5" />
          Explorer
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={activeSurface === 'changes'}
          variant={activeSurface === 'changes' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => {
            setFilesPanelTab('changes');
            setSurface('changes');
            if (mobile) setMobileSurface('files');
          }}
        >
          <GitBranch className="size-3.5" />
          Changes
        </Button>
        {hasEditorDocs && (
          <Button
            type="button"
            role="tab"
            aria-selected={activeSurface === 'editor'}
            variant={activeSurface === 'editor' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => {
              setSurface('editor');
              if (mobile) setMobileSurface('editor');
            }}
          >
            <Code2 className="size-3.5" />
            Editor
          </Button>
        )}
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
