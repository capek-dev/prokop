import { useState } from 'react';
import { toast } from 'sonner';
import {
  CircleDot,
  Copy,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import type { ManagedWorktree, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorktreeMutations, useWorktreeRefsQuery, useWorktreesQuery } from '@/hooks/queries';
import { useChatLayoutStore } from '@/stores/chatLayoutStore';
import { cn } from '@/lib/utils';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';

interface WorktreesPanelProps {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function copyPath(path: string): void {
  void navigator.clipboard.writeText(path).then(
    () => toast.success('Path copied'),
    () => toast.error('Could not copy path'),
  );
}

function describeBlocked(worktree: ManagedWorktree): string | null {
  if (worktree.state === 'removing') return 'Removal in progress';
  if (worktree.state === 'missing') return 'Directory is missing';
  if (worktree.dirty) return 'Has uncommitted changes';
  const running = worktree.attachments.filter((a) => a.running).length;
  if (running > 0) return `${running} running session${running > 1 ? 's' : ''} — stop ${running > 1 ? 'them' : 'it'} first`;
  return null;
}

interface RowProps {
  worktree: ManagedWorktree;
  removing: boolean;
  onRemove: () => void;
  onOpenInExplorer: (worktree: ManagedWorktree) => void;
}

function WorktreeRow({ worktree, removing, onRemove, onOpenInExplorer }: RowProps) {
  const blocked = describeBlocked(worktree);
  const unavailable = worktree.state !== 'available' && worktree.state !== 'removed';
  const removed = worktree.state === 'removed';

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/50',
        removed && 'opacity-50',
      )}
    >
      <GitBranch className={cn('size-3.5 shrink-0', unavailable ? 'text-destructive' : 'text-muted-foreground')} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{worktree.name}</span>
          {worktree.branch && worktree.branch !== worktree.name && (
            <span className="hidden min-w-0 truncate font-mono text-[11px] text-muted-foreground sm:inline">
              ({worktree.branch})
            </span>
          )}
          {unavailable && (
            <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              {worktree.state}
            </span>
          )}
          {removed && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              removed
            </span>
          )}
        </div>
        {blocked && !removed && (
          <span className="truncate text-[11px] text-muted-foreground">{blocked}</span>
        )}
        {!blocked && !removed && worktree.attachments.length > 0 && (
          <span className="truncate text-[11px] text-muted-foreground/70">
            {worktree.attachments.length} session{worktree.attachments.length > 1 ? 's' : ''} attached
          </span>
        )}
      </div>
      {removing ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0"
              aria-label={`Actions for ${worktree.name}`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              disabled={worktree.state !== 'available'}
              onClick={() => onOpenInExplorer(worktree)}
            >
              <ExternalLink className="size-4" />
              Open in Explorer
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => copyPath(worktree.path)}>
              <Copy className="size-4" />
              Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={Boolean(blocked) && !removed}
              onClick={onRemove}
              variant="destructive"
            >
              <Trash2 className="size-4" />
              {removed ? 'Purge record' : 'Remove'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * Worktree management surface: every managed worktree in the workspace with
 * per-row open/copy/remove actions. Blocked removals explain themselves
 * inline (running session, dirty tree, missing directory) instead of
 * failing after the fact. Live-updates through worktree.updated events.
 */
export function WorktreesPanel({ sdkClient, workspaceId }: WorktreesPanelProps) {
  const [creating, setCreating] = useState(false);
  const worktrees = useWorktreesQuery(sdkClient, workspaceId);
  const refs = useWorktreeRefsQuery(sdkClient, workspaceId);
  const mutations = useWorktreeMutations(sdkClient, workspaceId);
  const all = worktrees.data ?? [];

  const openInExplorer = (worktree: ManagedWorktree) => {
    // Pinning the worktree path reuses the existing root switcher so the
    // explorer and changes views follow the selected worktree root.
    const store = useChatLayoutStore.getState();
    store.setFilesPanelRoot(worktree.path);
    store.setFilesPanelRootPinned(true);
    store.setFilesPanelTab('project');
    store.setWorkbenchSurface('explorer');
    store.setShowFilesPanel(true);
  };

  const remove = (worktree: ManagedWorktree) => {
    mutations.remove.mutate(worktree.id, {
      onSuccess: (updated) => {
        if (updated.state === 'removed') {
          toast.success(`Removed ${worktree.name}`);
        } else {
          toast.error(`Could not remove ${worktree.name}`);
        }
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  const createWorktree = (input: { name: string; branch: string }, complete: () => void) => {
    mutations.create.mutate(input, {
      onSuccess: () => {
        complete();
        setCreating(false);
        toast.success(`Created ${input.name}`);
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  if (worktrees.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-worktrees-panel>
      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Worktrees
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCreating((value) => !value)}
          aria-label={creating ? 'Close new worktree form' : 'New worktree'}
          aria-expanded={creating}
        >
          {creating ? <CircleDot className="size-3.5" /> : <Plus className="size-3.5" />}
        </Button>
      </div>

      {creating && (
        <div className="border-b border-border/50 p-2">
          <WorktreeCreateForm
            refs={refs.data ?? []}
            existingWorktreeNames={all
              .filter((worktree) => worktree.state !== 'removed')
              .map((worktree) => worktree.name)}
            refsLoading={refs.isLoading}
            pending={mutations.create.isPending}
            onCancel={() => setCreating(false)}
            onCreate={createWorktree}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {all.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 px-4 py-12 text-center">
            <FolderOpen className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No worktrees yet</p>
          </div>
        ) : (
          all.map((worktree) => (
            <WorktreeRow
              key={worktree.id}
              worktree={worktree}
              removing={worktree.state === 'removing'}
              onRemove={() => remove(worktree)}
              onOpenInExplorer={openInExplorer}
            />
          ))
        )}
      </div>
    </div>
  );
}
