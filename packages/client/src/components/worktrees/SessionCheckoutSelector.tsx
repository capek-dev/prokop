import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Folder, GitBranch, Plus } from 'lucide-react';
import type { ManagedWorktree, ProkopaiClient, Session } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';
import { useWorktreeMutations, useWorktreeRefsQuery, useWorktreesQuery } from '@/hooks/queries';
import { getWorktreeDisplayName } from '@/lib/sessionWorktree';
import { cn } from '@/lib/utils';

interface CheckoutProps {
  session: Session;
  sdkClient: ProkopaiClient | null;
  disabled?: boolean;
}

interface StripProps extends CheckoutProps {
  /** Locked after the first message: renders as a non-interactive label. */
  locked?: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useSessionCheckout({ session, sdkClient }: CheckoutProps) {
  const worktrees = useWorktreesQuery(sdkClient, session.workspaceId);
  const mutations = useWorktreeMutations(sdkClient, session.workspaceId);
  const all = worktrees.data ?? [];
  const available = all.filter((worktree) => worktree.state === 'available');
  const bound = all.find((worktree) => worktree.id === session.workspaceRootId)
    ?? (session.workspaceRootId ? session.worktree : null)
    ?? null;
  // Unavailable requires affirmative evidence: a fetched record (or session
  // binding) whose state is not 'available'. While the query is still
  // loading, bound is null and the strip must stay neutral, not flash red.
  const boundAvailable = !session.workspaceRootId
    || !bound
    || bound.state === 'available';
  const pending = mutations.bind.isPending
    || mutations.unbind.isPending
    || mutations.create.isPending;

  const commit = (worktreeId: string | null, onDone: () => void) => {
    onDone();
    if (worktreeId === (session.workspaceRootId ?? null)) return;
    const onError = (error: unknown) => toast.error(errorMessage(error));
    if (worktreeId === null) {
      mutations.unbind.mutate(session.id, { onError });
    } else {
      mutations.bind.mutate({ sessionId: session.id, worktreeId }, { onError });
    }
  };

  const createWorktree = (
    input: { name: string; branch: string },
    complete: () => void,
    onDone: () => void,
  ) => {
    mutations.create.mutate(input, {
      onSuccess: (worktree) => {
        mutations.bind.mutate(
          { sessionId: session.id, worktreeId: worktree.id },
          {
            onSuccess: () => {
              complete();
              onDone();
            },
            onError: (error) => toast.error(errorMessage(error)),
          },
        );
      },
      onError: (error) => toast.error(errorMessage(error)),
    });
  };

  return { all, available, bound, boundAvailable, pending, commit, createWorktree };
}

function RowMeta({ worktree }: { worktree: ManagedWorktree }) {
  const running = worktree.attachments.filter((attachment) => attachment.running).length;
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
      {worktree.dirty && (
        <span className="size-1.5 rounded-full bg-warning" title="Has uncommitted changes" />
      )}
      {running > 0 && (
        <span className="whitespace-nowrap">
          {running} session{running > 1 ? 's' : ''}
        </span>
      )}
    </span>
  );
}

/** Fetches refs only when the create pane is open, not for every selector render. */
function CreatePane({
  sdkClient,
  workspaceId,
  existingWorktreeNames,
  pending,
  onCancel,
  onCreate,
}: {
  sdkClient: ProkopaiClient | null;
  workspaceId: string;
  existingWorktreeNames: string[];
  pending: boolean;
  onCancel: () => void;
  onCreate: (input: { name: string; branch: string }, complete: () => void) => void;
}) {
  const refs = useWorktreeRefsQuery(sdkClient, workspaceId);
  return (
    <WorktreeCreateForm
      refs={refs.data ?? []}
      existingWorktreeNames={existingWorktreeNames}
      refsLoading={refs.isLoading}
      pending={pending}
      onCancel={onCancel}
      onCreate={onCreate}
    />
  );
}

/**
 * Shared popover body: searchable checkout list plus an inline create pane.
 * Both the input-row selector and the strip below the input use it.
 */
function CheckoutMenu({ session, sdkClient, onClose }: {
  session: Session;
  sdkClient: ProkopaiClient | null;
  onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const checkout = useSessionCheckout({ session, sdkClient });
  const { all, available, bound, boundAvailable, pending, commit, createWorktree } = checkout;

  if (creating) {
    return (
      <div className="p-3">
        <CreatePane
          sdkClient={sdkClient}
          workspaceId={session.workspaceId}
          existingWorktreeNames={all
            .filter((worktree) => worktree.state !== 'removed')
            .map((worktree) => worktree.name)}
          pending={pending}
          onCancel={() => setCreating(false)}
          onCreate={(input, complete) => createWorktree(input, complete, onClose)}
        />
      </div>
    );
  }

  return (
    <Command>
      <CommandInput placeholder="Search worktrees…" />
      <CommandList>
        <CommandEmpty>No matching worktrees.</CommandEmpty>
        <CommandGroup>
          <CommandItem
            value="primary checkout"
            showCheck={false}
            onSelect={() => commit(null, onClose)}
          >
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            Primary checkout
            {!session.workspaceRootId && <Check className="ml-auto size-3.5 shrink-0" />}
          </CommandItem>
          {bound && !boundAvailable && (
            <CommandItem disabled value={`${bound.name} unavailable`}>
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{bound.name}</span>
              <span className="ml-auto text-[11px] text-destructive">{bound.state}</span>
            </CommandItem>
          )}
          {available.map((worktree) => (
            <CommandItem
              key={worktree.id}
              value={`${worktree.name} ${worktree.branch ?? ''}`}
              showCheck={false}
              onSelect={() => commit(worktree.id, onClose)}
            >
              <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{worktree.name}</span>
              {worktree.branch && worktree.branch !== worktree.name && (
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {worktree.branch}
                </span>
              )}
              <RowMeta worktree={worktree} />
              {worktree.id === session.workspaceRootId && (
                <Check className="size-3.5 shrink-0" />
              )}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup>
          <CommandItem showCheck={false} onSelect={() => setCreating(true)}>
            <Plus className="size-3.5 shrink-0" />
            New worktree
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

/**
 * Compact checkout picker for the input selector row. Renders nothing when
 * the workspace has no managed worktrees and the session is unbound. On
 * small screens it collapses to an icon-only button, matching its siblings.
 */
export function SessionCheckoutSelector({ session, sdkClient, disabled }: CheckoutProps) {
  const [open, setOpen] = useState(false);
  const { all, bound, boundAvailable, pending } = useSessionCheckout({ session, sdkClient });

  if (all.length === 0 && !session.workspaceRootId) return null;

  const label = session.workspaceRootId
    ? (bound ? getWorktreeDisplayName(bound) : 'Managed checkout')
    : 'Primary checkout';
  const tooltip = `Session checkout: ${label}`;

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || pending}
                aria-label={tooltip}
                className="relative h-8 w-8 justify-center p-0 text-muted-foreground hover:text-foreground"
              >
                {session.workspaceRootId ? (
                  <GitBranch className="size-4 shrink-0" />
                ) : (
                  <Folder className="size-4 shrink-0" />
                )}
                {!boundAvailable && (
                  <span
                    className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive"
                    title={`Worktree is ${bound?.state ?? 'unavailable'}`}
                  />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start" side="top" sideOffset={8}>
              <CheckoutMenu session={session} sdkClient={sdkClient} onClose={() => setOpen(false)} />
            </PopoverContent>
          </Popover>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Readout tab shown below the input for sessions bound to a worktree.
 * Displays only the worktree and branch. Interactive until the first
 * message is sent (opens the shared checkout menu to rebind); locked
 * afterwards, rendering the same content as a plain label.
 */
export function SessionCheckoutStrip({ session, sdkClient, locked }: StripProps) {
  const [open, setOpen] = useState(false);
  const { bound, boundAvailable, pending } = useSessionCheckout({ session, sdkClient });
  if (!session.workspaceRootId) return null;

  const label = bound ? getWorktreeDisplayName(bound) : 'Managed checkout';

  const content = (
    <>
      <GitBranch className="size-3 shrink-0" />
      <span className="min-w-0 truncate font-medium">{label}</span>
      {bound?.branch && bound.branch !== label && (
        <span className="hidden min-w-0 truncate text-muted-foreground/80 sm:inline">
          (<span className="font-mono">{bound.branch}</span>)
        </span>
      )}
      {!boundAvailable && (
        <span className="shrink-0">unavailable ({bound?.state ?? 'unknown'})</span>
      )}
    </>
  );

  if (locked) {
    return (
      <div className="mx-auto flex w-[85%] justify-center">
        <div
          title={boundAvailable ? 'Session checkout' : `Worktree is ${bound?.state ?? 'unavailable'}`}
          className={cn(
            'flex w-full select-none items-center justify-center gap-1.5 rounded-b-lg border border-t-0 px-2.5 py-1 text-[11px]',
            boundAvailable
              ? 'border-border/60 bg-muted text-muted-foreground'
              : 'border-destructive/40 bg-destructive/15 text-destructive',
          )}
        >
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-[85%] justify-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={pending}
            title="Change session checkout"
            className={cn(
              'flex w-full items-center justify-center gap-1.5 rounded-b-lg border border-t-0 px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60',
              boundAvailable
                ? 'border-border/60 bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                : 'border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/20',
              open && boundAvailable && 'border-ring/30',
            )}
          >
            <GitBranch className="size-3 shrink-0" />
            <span className="min-w-0 truncate font-medium">{label}</span>
            {bound?.branch && bound.branch !== label && (
              <span className="hidden min-w-0 truncate text-muted-foreground/80 sm:inline">
                (<span className="font-mono">{bound.branch}</span>)
              </span>
            )}
            {!boundAvailable && (
              <span className="shrink-0">unavailable ({bound?.state ?? 'unknown'})</span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="center" side="top" sideOffset={8}>
          <CheckoutMenu session={session} sdkClient={sdkClient} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
