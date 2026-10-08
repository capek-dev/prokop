import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitPullRequest, RefreshCw } from 'lucide-react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSessionBoardStore } from '@/stores/sessionBoardStore';
import { useWorktreesQuery } from '@/hooks/queries';
import { buildFilesPanelRootOptions, resolveFilesPanelRoot } from '@/lib/sessionWorktree';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PullRequestDetailView } from './PullRequestDetailView';
import { PullRequestCreateForm } from './PullRequestCreateForm';
import { PrError, PrSelect, prKey, type PullRequestContext } from './shared';

export function PullRequestsView({
  client,
  serverId,
  workspaceId,
}: {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
}) {
  const visible = useWorkspaceViewVisible();
  const [visited, setVisited] = useState(visible);
  if (visible && !visited) setVisited(true);
  if (!visible && !visited) return null;
  return (
    <PullRequestsContent client={client} serverId={serverId} workspaceId={workspaceId} visible={visible} />
  );
}

function PullRequestsContent({
  client,
  serverId,
  workspaceId,
  visible,
}: {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
  visible: boolean;
}) {
  const workspace = useServerDataStore(
    (s) => s.workspaces.find((w) => w.id === workspaceId) ?? s.activeWorkspace,
  );
  const focused = useSessionBoardStore((s) => s.focusedSessionId);
  const session = useSessionStore((s) =>
    s.sessions.find((item) => item.id === focused && item.workspaceId === workspaceId),
  );
  const worktrees = useWorktreesQuery(client, workspaceId);
  const [chosenRoot, setChosenRoot] = useState<string | null>(null);
  const options = workspace ? buildFilesPanelRootOptions(workspace, worktrees.data ?? []) : [];
  const resolution = resolveFilesPanelRoot({
    workspacePath: workspace?.path ?? '',
    workspaceRootId: session?.workspaceRootId,
    worktree: worktrees.data?.find((w) => w.id === session?.workspaceRootId) ?? session?.worktree,
    pinned: chosenRoot !== null,
    pinnedRoot: chosenRoot,
    allowedRoots: options.map((o) => o.value),
  });
  const root = resolution.isPrimary ? undefined : resolution.selectedRoot;
  return (
    <section aria-label="Pull requests" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-end gap-2 border-b p-3">
        <GitPullRequest className="mb-2 size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <PrSelect
            label="Checkout"
            value={resolution.selectedRoot}
            onChange={setChosenRoot}
            options={options}
          />
          <p className="mt-1 break-all text-xs text-muted-foreground" aria-label="Checkout path">
            {resolution.selectedRoot}
          </p>
        </div>
      </div>
      {resolution.blocked ? (
        <PrError error="This session's checkout is unavailable. Select an available checkout to browse PRs." />
      ) : (
        <RepositoryView
          key={`${workspaceId}:${root ?? ''}`}
          client={client}
          serverId={serverId}
          workspaceId={workspaceId}
          root={root}
          visible={visible}
        />
      )}
    </section>
  );
}

function RepositoryView({
  client,
  serverId,
  workspaceId,
  root,
  visible,
}: {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
  root?: string;
  visible: boolean;
}) {
  const cache = useQueryClient();
  const [remote, setRemote] = useState<string | null>(null);
  const connections = useQuery({
    queryKey: ['pull-requests', serverId, workspaceId, 'connections', root ?? ''],
    queryFn: () => client.http.pullRequests.discover(workspaceId, root),
    enabled: visible,
    retry: false,
    staleTime: 30_000,
  });
  const connection =
    connections.data?.connections.find((c) => c.repository.remote === remote) ??
    connections.data?.connections[0];
  const rescan = () => {
    // Drop data authenticated as a previous CLI account before discovering its replacement.
    cache.removeQueries({
      predicate: (q) =>
        q.queryKey[0] === 'pull-requests' &&
        q.queryKey[1] === serverId &&
        q.queryKey[2] === workspaceId &&
        q.queryKey[3] !== 'connections',
    });
    void connections.refetch();
  };
  return (
    <>
      <div className="flex shrink-0 items-end gap-2 p-3">
        {!!connections.data?.connections.length && (
          <div className="min-w-0 flex-1">
            <PrSelect
              label="Repository"
              value={connection?.repository.remote ?? ''}
              onChange={setRemote}
              options={(connections.data?.connections ?? []).map((c) => ({
                value: c.repository.remote,
                label: `${c.repository.provider === 'github' ? 'GitHub' : 'Azure'} · ${c.repository.project ?? c.repository.owner}/${c.repository.name} (${c.repository.remote})`,
              }))}
            />
          </div>
        )}
        <Button
          variant="ghost"
          size={connections.data?.connections.length ? 'icon' : 'sm'}
          aria-label="Rescan CLI connections"
          onClick={rescan}
          disabled={connections.isFetching}
        >
          <RefreshCw className={connections.isFetching ? 'animate-spin' : undefined} />
          {!connections.data?.connections.length &&
            (connections.isFetching ? 'Checking repositories…' : 'Check again')}
        </Button>
      </div>
      {connections.isPending && <Skeleton className="mx-3 h-16" />}
      <PrError error={connections.error} />
      {!connections.error && !connections.isFetching && connections.data?.connections.length === 0 && (
        <div className="flex flex-col gap-2 p-3 text-sm text-muted-foreground">
          <p>No GitHub or Azure DevOps remote was found in this checkout.</p>
          <p>
            Check the path above. To use another project, choose it in the workspace selector beside Sessions.
            For another checkout of this project, use Checkout above.
          </p>
        </div>
      )}
      {connection?.status === 'unavailable' && (
        <div className="flex flex-col gap-3 p-3">
          <PrError error={connection.message} />
          <p className="text-sm text-muted-foreground">
            Run setup on the machine hosting Prokop, then rescan.
          </p>
          <pre className="overflow-auto text-xs">
            {connection.repository.provider === 'github'
              ? 'gh auth login'
              : 'az extension add --name azure-devops\naz login'}
          </pre>
        </div>
      )}
      {connection?.status === 'connected' && connection.accountId && (
        <RepositoryInbox
          key={`${connection.repository.key}:${connection.repository.remote}:${connection.accountId}`}
          visible={visible}
          branch={connections.data?.branch ?? ''}
          accountName={connection.accountName ?? ''}
          ctx={{
            client,
            serverId,
            workspaceId,
            provider: connection.repository.provider,
            accountId: connection.accountId,
            scope: { root, remote: connection.repository.remote, repositoryKey: connection.repository.key },
          }}
        />
      )}
    </>
  );
}

function RepositoryInbox({
  ctx,
  branch,
  accountName,
  visible,
}: {
  ctx: PullRequestContext;
  branch: string;
  accountName: string;
  visible: boolean;
}) {
  const [state, setState] = useState('open');
  const [query, setQuery] = useState('');
  const [involvement, setInvolvement] = useState('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const cache = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: [...prKey(ctx), 'list', state],
    queryFn: async ({ pageParam }) => {
      const result = await ctx.client.http.pullRequests.list(ctx.workspaceId, ctx.scope, state, pageParam);
      if (result.accountId !== ctx.accountId)
        throw new Error('The CLI account changed. Rescan connections before continuing.');
      return result;
    },
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
    enabled: visible,
    retry: false,
    staleTime: 30_000,
  });
  const items =
    list.data?.pages
      .flatMap((p) => p.items)
      .filter((p, i, all) => all.findIndex((x) => x.number === p.number) === i) ?? [];
  const filtered = items.filter(
    (p) =>
      (involvement === 'all' ||
        (involvement === 'mine'
          ? p.author.id === ctx.accountId
          : p.requestedReviewerIds?.includes(ctx.accountId))) &&
      `${p.number} ${p.title} ${p.author.name} ${p.sourceBranch}`.toLowerCase().includes(query.toLowerCase()),
  );
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: prKey(ctx) });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 pb-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          Signed in as {accountName}
        </span>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={list.isFetching}>
          Refresh
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
            setSelected(null);
          }}
        >
          New PR
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            'flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r md:w-72',
            (selected !== null || creating) && 'hidden md:flex',
          )}
        >
          <div className="flex flex-col gap-2 p-3">
            <Input
              aria-label="Search loaded pull requests"
              placeholder="Search loaded pull requests"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <PrSelect
              label="State"
              value={state}
              onChange={setState}
              options={['open', 'closed', 'merged', 'all'].map((value) => ({
                value,
                label: value[0].toUpperCase() + value.slice(1),
              }))}
            />
            <PrSelect
              label="Involvement"
              value={involvement}
              onChange={setInvolvement}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'mine', label: 'Authored by me' },
                { value: 'reviewing', label: 'Review requested' },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            <PrError error={list.error} />
            {list.isPending && <Skeleton className="h-24" />}
            {filtered.map((pr) => (
              <button
                key={pr.number}
                type="button"
                onClick={() => {
                  setSelected(pr.number);
                  setCreating(false);
                }}
                aria-pressed={selected === pr.number}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md p-2 text-left hover:bg-muted',
                  selected === pr.number && 'bg-muted',
                )}
              >
                <span className="line-clamp-2 text-sm">
                  <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{pr.draft ? 'Draft' : pr.state}</Badge>
                  <span className="truncate">{pr.author.name}</span>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {pr.sourceBranch} → {pr.targetBranch}
                </span>
              </button>
            ))}
            {!list.isPending && !list.error && !filtered.length && (
              <p className="p-2 text-sm text-muted-foreground">
                No matching pull requests in the loaded results.
              </p>
            )}
            {list.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                Load more
              </Button>
            )}
          </div>
        </aside>
        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
            selected === null && !creating && 'hidden md:flex',
          )}
        >
          {(selected !== null || creating) && (
            <div className="shrink-0 p-2 md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelected(null);
                  setCreating(false);
                }}
              >
                <ArrowLeft />
                Pull requests
              </Button>
            </div>
          )}
          {creating ? (
            <PullRequestCreateForm
              ctx={ctx}
              branch={branch}
              onCreated={(number) => {
                refresh();
                setCreating(false);
                setSelected(number);
              }}
              onCancel={() => setCreating(false)}
            />
          ) : selected !== null ? (
            <PullRequestDetailView key={selected} ctx={ctx} number={selected} visible={visible} />
          ) : (
            <p className="m-auto p-6 text-sm text-muted-foreground">
              Select a pull request to review its changes.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
