import { useState } from 'react';
import { Folder, GitBranch, Plus } from 'lucide-react';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorktreeMutations, useWorktreeRefsQuery, useWorktreesQuery } from '@/hooks/queries';
import { getWorktreeDisplayName } from '@/lib/sessionWorktree';
import { WorktreeCreateForm } from '@/components/worktrees/WorktreeCreateForm';

interface EmptySessionCheckoutProps {
  session: Session;
  sdkClient: ProkopaiClient | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EmptySessionCheckout({
  session,
  sdkClient,
}: EmptySessionCheckoutProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const worktrees = useWorktreesQuery(sdkClient, session.workspaceId);
  const refs = useWorktreeRefsQuery(sdkClient, session.workspaceId);
  const mutations = useWorktreeMutations(sdkClient, session.workspaceId);
  const availableWorktrees = (worktrees.data ?? []).filter(
    (worktree) => worktree.state === 'available',
  );
  const selectedAvailable = availableWorktrees.some(
    (worktree) => worktree.id === session.workspaceRootId,
  );
  const value = creating
    ? 'new'
    : session.workspaceRootId
      ? selectedAvailable ? session.workspaceRootId : `unavailable:${session.workspaceRootId}`
      : 'primary';
  const pending = mutations.bind.isPending
    || mutations.unbind.isPending
    || mutations.create.isPending;

  const selectCheckout = (nextValue: string) => {
    setError(null);
    if (nextValue === 'new') {
      setCreating(true);
      return;
    }
    setCreating(false);
    if (nextValue === 'primary') {
      if (!session.workspaceRootId) return;
      mutations.unbind.mutate(session.id, {
        onError: (cause) => setError(errorMessage(cause)),
      });
      return;
    }
    mutations.bind.mutate(
      { sessionId: session.id, worktreeId: nextValue },
      { onError: (cause) => setError(errorMessage(cause)) },
    );
  };

  const createWorktree = (
    input: { name: string; branch: string },
    complete: () => void,
  ) => {
    setError(null);
    mutations.create.mutate(
      input,
      {
        onSuccess: (worktree) => {
          mutations.bind.mutate(
            { sessionId: session.id, worktreeId: worktree.id },
            {
              onSuccess: () => {
                complete();
                setCreating(false);
              },
              onError: (cause) => setError(errorMessage(cause)),
            },
          );
        },
        onError: (cause) => setError(errorMessage(cause)),
      },
    );
  };

  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-lg font-medium">Start a conversation</p>
        <p className="text-sm text-muted-foreground">
          Choose a checkout before your first message. The choice is then locked for this session.
        </p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-2">
        <Select value={value} onValueChange={selectCheckout} disabled={pending || worktrees.isLoading}>
          <SelectTrigger className="w-full" aria-label="Session checkout">
            <SelectValue placeholder="Select checkout" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="primary">
                <Folder />
                Primary checkout
              </SelectItem>
              <SelectItem value="new">
                <Plus />
                New worktree
              </SelectItem>
              {session.workspaceRootId && !selectedAvailable && (
                <SelectItem value={`unavailable:${session.workspaceRootId}`} disabled>
                  <GitBranch />
                  Unavailable checkout
                </SelectItem>
              )}
              {availableWorktrees.map((worktree) => (
                <SelectItem key={worktree.id} value={worktree.id}>
                  <GitBranch />
                  {getWorktreeDisplayName(worktree)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {creating && (
          <WorktreeCreateForm
            refs={refs.data ?? []}
            existingWorktreeNames={(worktrees.data ?? [])
              .filter((worktree) => worktree.state !== 'removed')
              .map((worktree) => worktree.name)}
            refsLoading={refs.isLoading}
            pending={pending}
            onCreate={createWorktree}
          />
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
