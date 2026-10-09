import { useState } from 'react';
import type { ReactNode } from 'react';
import { useInfiniteQuery, useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, GitPullRequest, Plus, RefreshCw } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { PullRequestDetailView } from './PullRequestDetailView';
import { PullRequestCreateForm } from './PullRequestCreateForm';
import {
  CopyCommand,
  PrError,
  PrSelect,
  PrStateIcon,
  prKey,
  relativeTime,
  type PullRequestContext,
} from './shared';

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
  const checkout = (
    <>
      <GitPullRequest className="size-4 shrink-0 text-muted-foreground" />
      <PrSelect
        compact
        label="Checkout"
        title={resolution.selectedRoot}
        value={resolution.selectedRoot}
        onChange={setChosenRoot}
        options={options}
      />
      <span
        aria-label="Checkout path"
        title={resolution.selectedRoot}
        className="hidden max-w-64 truncate text-xs text-muted-foreground @4xl:inline"
      >
        {resolution.selectedRoot}
      </span>
    </>
  );
  return (
    <section aria-label="Pull requests" className="@container flex min-h-0 flex-1 flex-col overflow-hidden">
      {resolution.blocked ? (
        <>
          <Toolbar left={checkout} />
          <div className="p-3">
            <PrError error="This session's checkout is unavailable. Select an available checkout to browse PRs." />
          </div>
        </>
      ) : (
        <RepositoryView
          key={`${workspaceId}:${root ?? ''}`}
          client={client}
          serverId={serverId}
          workspaceId={workspaceId}
          root={root}
          visible={visible}
          checkout={checkout}
          checkoutPath={resolution.selectedRoot}
        />
      )}
    </section>
  );
}

function Toolbar({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      {left}
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </div>
  );
}

function RepositoryView({
  client,
  serverId,
  workspaceId,
  root,
  visible,
  checkout,
  checkoutPath,
}: {
  client: ProkopaiClient;
  serverId: string;
  workspaceId: string;
  root?: string;
  visible: boolean;
  checkout: ReactNode;
  checkoutPath: string;
}) {
  const cache = useQueryClient();
  // Overview and Workspace mount their own copy of this view, so the mode is fixed per instance.
  const [inOverview] = useState(() => window.location.pathname.includes('/overview'));
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
  const fetching = useIsFetching({
    predicate: (q) =>
      q.queryKey[0] === 'pull-requests' && q.queryKey[1] === serverId && q.queryKey[2] === workspaceId,
  });
  // One refresh for everything: re-check the CLI sign-in and reload every visible PR query.
  // Queries are keyed by account, so data from a previous CLI account is never shown.
  const refresh = () => {
    void connections.refetch();
    void cache.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === 'pull-requests' &&
        q.queryKey[1] === serverId &&
        q.queryKey[2] === workspaceId &&
        q.queryKey[3] !== 'connections',
    });
  };
  const hasConnections = !!connections.data?.connections.length;
  const toolbar = (right?: ReactNode) => (
    <Toolbar
      left={
        <>
          {checkout}
          {hasConnections && (
            <PrSelect
              compact
              label="Repository"
              value={connection?.repository.remote ?? ''}
              onChange={setRemote}
              options={(connections.data?.connections ?? []).map((c) => ({
                value: c.repository.remote,
                label: `${c.repository.provider === 'github' ? 'GitHub' : 'Azure'} · ${c.repository.project ?? c.repository.owner}/${c.repository.name} (${c.repository.remote})`,
              }))}
            />
          )}
        </>
      }
      right={
        <>
          <Button
            variant="ghost"
            size={hasConnections ? 'icon-sm' : 'sm'}
            aria-label="Rescan CLI connections"
            title="Refresh sign-in and pull requests"
            onClick={refresh}
            disabled={connections.isFetching}
          >
            <RefreshCw className={fetching ? 'animate-spin' : undefined} />
            {!hasConnections && (connections.isFetching ? 'Checking repositories…' : 'Check again')}
          </Button>
          {right}
        </>
      }
    />
  );
  return (
    <>
      {!(connection?.status === 'connected' && connection.accountId) && toolbar()}
      {connections.isPending && <Skeleton className="m-3 h-16" />}
      <PrError error={connections.error} />
      {!connections.error && !connections.isFetching && connections.data?.connections.length === 0 && (
        <div className="flex flex-col gap-2 p-3 text-sm text-muted-foreground">
          <p>No GitHub or Azure DevOps remote was found in this checkout.</p>
          <p className="break-all font-mono text-xs">{checkoutPath}</p>
          <p>
            {inOverview
              ? 'To use another project, use the pull requests button on its header in the session list.'
              : 'To use another project, choose it in the workspace selector beside Sessions.'}
            {' '}For another checkout of this project, use the checkout selector above.
          </p>
        </div>
      )}
      {connection?.status === 'unavailable' && (
        <div className="flex flex-col gap-3 p-3">
          <PrError error={connection.message} />
          <p className="text-sm text-muted-foreground">
            Run this in a terminal on the machine hosting Prokop, then rescan.
          </p>
          <CopyCommand
            command={
              connection.command ?? (connection.repository.provider === 'github' ? 'gh auth login' : 'az login')
            }
          />
        </div>
      )}
      {connection?.status === 'connected' && connection.accountId && (
        <RepositoryInbox
          key={`${connection.repository.key}:${connection.repository.remote}:${connection.accountId}`}
          visible={visible}
          branch={connections.data?.branch ?? ''}
          accountName={connection.accountName ?? ''}
          toolbar={toolbar}
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
  toolbar,
}: {
  ctx: PullRequestContext;
  branch: string;
  accountName: string;
  visible: boolean;
  toolbar(right: ReactNode): ReactNode;
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
      {toolbar(
        <>
          <span
            className="hidden max-w-48 truncate px-1 text-xs text-muted-foreground @2xl:inline"
            title={`Signed in as ${accountName}`}
          >
            {accountName}
          </span>
          <Button
            size="sm"
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
          >
            <Plus />
            New PR
          </Button>
        </>,
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className={cn(
            'flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-r md:w-72',
            (selected !== null || creating) && 'hidden md:flex',
          )}
        >
          <div className="flex flex-col gap-2 p-3">
            <Tabs value={state} onValueChange={setState}>
              <TabsList className="w-full" aria-label="State">
                {['open', 'merged', 'closed', 'all'].map((value) => (
                  <TabsTrigger key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex gap-2">
              <Input
                aria-label="Search loaded pull requests"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select value={involvement} onValueChange={setInvolvement}>
                <SelectTrigger aria-label="Involvement" className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  <SelectItem value="mine">Authored by me</SelectItem>
                  <SelectItem value="reviewing">Review requested</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            <PrError error={list.error} />
            {list.isPending && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            )}
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
                  'flex w-full gap-2 rounded-md p-2 text-left hover:bg-muted',
                  selected === pr.number && 'bg-muted',
                )}
              >
                <PrStateIcon pr={pr} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="line-clamp-2 text-sm font-medium">{pr.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    #{pr.number} · {pr.author.name}
                    {pr.updatedAt && ` · ${relativeTime(pr.updatedAt)}`}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {pr.sourceBranch} → {pr.targetBranch}
                    </span>
                    {pr.requestedReviewerIds?.includes(ctx.accountId) && (
                      <Badge variant="outline" className="text-warning">
                        Review requested
                      </Badge>
                    )}
                  </span>
                </span>
              </button>
            ))}
            {!list.isPending && !list.error && !filtered.length && (
              <p className="p-2 text-sm text-muted-foreground">
                {items.length
                  ? 'No loaded pull requests match these filters.'
                  : `No ${state === 'all' ? '' : `${state} `}pull requests.`}
              </p>
            )}
            {list.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
              >
                {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
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
