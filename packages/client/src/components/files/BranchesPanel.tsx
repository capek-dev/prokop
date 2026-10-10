import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Download, GitBranch, GitMerge, Loader2, MoreHorizontal, Plus, RefreshCw, X } from 'lucide-react';
import { CommitPatch } from './CommitPatch';
import { RebasePanel, rebaseKey } from './RebasePanel';
import type { GitBranchAction, GitBranchInfo, GitBranchPushReview, GitBranchPushTarget, GitHistoryEntry, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/components/providers/ThemeProvider';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { useGitStatusSubscription } from '@/hooks/queries/useFileQueries';
import { branchLabelInGroup, groupBranchesByPrefix } from './branchGroups';
import { branchSync, buildHistoryRows, fetchedLabel, isFetchStale, recentBranches, refLabel, refsByHead, relativeAge, timestampLabel } from './branchHistory';
import { canRetryWithoutHooks, GitOutput, pushFailure, PushProgress } from './GitPushFeedback';

interface Props {
  sdkClient: ProkopaiClient | null;
  serverId?: string;
  workspaceId: string;
  root?: string;
}
type HistoryEntry = GitHistoryEntry;

const pushKey = (serverId: string | undefined, workspaceId: string, root: string | undefined) => ['git-branch-push', serverId, workspaceId, root] as const;
type PushAction = Extract<GitBranchAction, { action: 'push' }>;

/** Display clock for relative times ("5m", "Fetched 2h ago"); not a data poll. */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function BranchesPanel({ sdkClient, serverId, workspaceId, root }: Props) {
  const cache = useQueryClient();
  const now = useNow();
  // HEAD moves (agent or terminal commits, branch switches) arrive through the status feed.
  useGitStatusSubscription(sdkClient, workspaceId, root);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [rebaseOpen, setRebaseOpen] = useState(false);
  const rebase = useQuery({ queryKey: rebaseKey(serverId, workspaceId, root), queryFn: () => {
    if (!sdkClient) throw new Error('Not connected');
    return sdkClient.http.files.gitRebaseState(workspaceId, { root });
  }, enabled: !!sdkClient, retry: false });
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [createFrom, setCreateFrom] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pushBranch, setPushBranch] = useState<GitBranchInfo | null>(null);
  const [commit, setCommit] = useState<HistoryEntry | null>(null);
  const branches = useQuery({
    queryKey: ['git-branches', serverId, workspaceId, root],
    queryFn: () => { if (!sdkClient) throw new Error('Not connected'); return sdkClient.http.files.gitBranches(workspaceId, { root }); },
    enabled: !!sdkClient, retry: false,
  });
  const data = branches.data;
  const currentBranch = data?.branches.find((b) => b.current);
  const selected = selectedRef ? data?.branches.find((b) => b.ref === selectedRef) : currentBranch ?? data?.branches[0];
  const selectBranch = (ref: string) => {
    setSelectedRef(ref);
    setCommit(null);
    setCreateFrom(null);
    setPushBranch(null);
    setPickerOpen(false);
    setSearch('');
  };
  const refresh = () => {
    for (const key of [['git-branches'], ['git-history'], ['git-repository'], ['git-rebase'], queryKeys.files.browsePrefix, queryKeys.files.gitStatusPrefix, ['files', 'git-diff'], queryKeys.worktrees.refsByWorkspace(workspaceId)]) {
      void cache.invalidateQueries({ queryKey: key });
    }
  };
  const mutation = useMutation({
    mutationFn: (input: GitBranchAction) => { if (!sdkClient) throw new Error('Not connected'); return sdkClient.http.files.gitBranchAction(workspaceId, { ...input, root }); },
    retry: false,
    onSuccess: (_result, input) => {
      if (input.action === 'create' || input.action === 'track') { setCreateFrom(null); setName(''); setSelectedRef(`refs/heads/${input.name}`); setCommit(null); }
      if (input.action === 'switch' || input.action === 'pull') setCommit(null);
    },
    onSettled: refresh,
  });
  // Mutations outlive their originating panel. Subscribe to the cache rather
  // than relying on a fresh useMutation observer after session navigation.
  const pushes = useMutationState({
    filters: { mutationKey: pushKey(serverId, workspaceId, root), exact: true },
    select: (entry) => ({
      status: entry.state.status,
      input: entry.state.variables as PushAction,
      error: entry.state.error,
      result: entry.state.data as { warning?: string } | undefined,
      submittedAt: entry.state.submittedAt,
    }),
  });
  const pendingPush = pushes.find((entry) => entry.status === 'pending');
  const lastPush = pushes.at(-1);
  const busy = mutation.isPending || !!pendingPush || rebase.isPending || !!rebase.data?.active;
  // A remote selection maps to a local branch name; when that local branch
  // already exists Checkout just switches to it instead of recreating.
  const resolveCheckout = (branch: GitBranchInfo) => {
    if (!data) return null;
    const remote = data.repository.remotes.find((r) => branch.name.startsWith(`${r}/`));
    if (!remote) return null;
    const localName = branch.name.slice(remote.length + 1);
    return { remote, localName, existing: data.branches.find((b) => b.kind === 'local' && b.name === localName) ?? null };
  };
  const checkoutRemote = async (branch: GitBranchInfo) => {
    const target = resolveCheckout(branch);
    if (!target || busy || !data?.repository.head) return;
    try {
      if (!target.existing) await mutation.mutateAsync({ action: 'track', remote: target.remote, branch: target.localName, name: target.localName, expectedHead: branch.head });
      await mutation.mutateAsync({ action: 'switch', name: target.localName, expectedBranch: data.repository.branch, expectedHead: data.repository.head, targetHead: target.existing ? target.existing.head : branch.head });
    } catch { /* surfaced through mutation.error */ }
  };
  // Current branch pulls its configured upstream into the checkout; any other
  // local branch fast-forwards in place without switching.
  const canPull = !!selected && !!data && selected.kind === 'local' && (selected.current
    ? !!data.repository.branch && !!data.repository.head && !!data.repository.upstream
    : !rebase.error && !selected.checkedOut && !!selected.upstream?.startsWith('refs/remotes/'));
  const pull = () => {
    if (busy || !canPull || !selected || !data) return;
    if (selected.current) {
      if (!data.repository.branch || !data.repository.head || !data.repository.upstream) return;
      mutation.mutate({ action: 'pull', expectedBranch: data.repository.branch, expectedHead: data.repository.head, ...data.repository.upstream });
    } else {
      setCommit(null);
      mutation.mutate({ action: 'pull-branch', name: selected.name, expectedHead: selected.head });
    }
  };
  const canPush = !!selected?.current && !!data?.repository.remotes.length;
  const openPush = () => { if (selected && canPush) { setPushBranch(selected); setCreateFrom(null); } };
  // Fetch the remote the inspected branch relates to; a lone remote is unambiguous.
  const fetchRemote = data && selected
    ? data.repository.remotes.find((r) => selected.upstream?.startsWith(`refs/remotes/${r}/`))
      ?? (selected.kind === 'remote' ? resolveCheckout(selected)?.remote : undefined)
      ?? (data.repository.remotes.length === 1 ? data.repository.remotes[0] : undefined)
    : undefined;
  const fetching = mutation.isPending && mutation.variables?.action === 'fetch';
  const recent = useMemo(() => recentBranches(data?.branches ?? []), [data?.branches]);
  if (!sdkClient) return <p className="p-3 text-xs text-muted-foreground">Connect to a server to manage branches.</p>;
  if (rebaseOpen) return <RebasePanel sdkClient={sdkClient} serverId={serverId} workspaceId={workspaceId} root={root} branches={data} onClose={() => setRebaseOpen(false)} onChanged={refresh} />;

  const localBranches = data?.branches.filter((b) => b.kind === 'local') ?? [];
  const remoteBranches = data?.branches.filter((b) => b.kind === 'remote') ?? [];
  // Recent repeats branches listed below, so it only earns its place when the
  // list is long enough to need it and the user is not searching.
  const showRecent = !search && localBranches.length > recent.length && recent.length > 1;
  const pickerItem = (b: GitBranchInfo, label: string, value: string, indent = false) => <CommandItem key={value} value={value} onSelect={() => selectBranch(b.ref)}>
    <span className={cn('min-w-0 flex-1 truncate', indent && 'pl-4')}>{label}</span>
    {!!b.ahead && <span className="shrink-0 text-[10px] tabular-nums text-success" title={`${b.ahead} to push`}>↑{b.ahead}</span>}
    {!!b.behind && <span className="shrink-0 text-[10px] tabular-nums text-warning" title={`${b.behind} to pull`}>↓{b.behind}</span>}
    {b.committedAt && <span className="min-w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70" title={`Last commit ${timestampLabel(b.committedAt)}`}>{relativeAge(b.committedAt, now)}</span>}
    <span className="flex w-10 shrink-0 justify-end">{b.current ? <Check /> : b.checkedOut ? <span className="text-xs text-muted-foreground">In use</span> : null}</span>
  </CommandItem>;

  const sync = selected && data ? branchSync(selected, data.branches, data.repository.remotes) : null;
  const stale = isFetchStale(data?.lastFetchedAt ?? null, now);
  const fetched = fetchedLabel(data?.lastFetchedAt ?? null, now);
  const countClass = 'shrink-0 rounded-sm font-medium tabular-nums enabled:hover:text-foreground disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  const syncTitle = stale ? `May be outdated: ${fetched.toLowerCase()}. Fetch to update.` : `Relative to the last fetch (${fetched.toLowerCase()})`;
  const syncStatus = (() => {
    if (!sync) return null;
    switch (sync.kind) {
      case 'remote': return <span className="truncate text-muted-foreground">Remote branch</span>;
      case 'unpublished': return canPush
        ? <button type="button" className={cn(countClass, 'text-foreground/80')} disabled={busy} title="Review and push this branch" onClick={openPush}>Not published</button>
        : <span className="truncate text-muted-foreground">{data?.repository.remotes.length ? 'Not published' : 'Local only'}</span>;
      case 'untracked': return <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate text-muted-foreground" title={`${sync.remote}/${sync.branch} exists, but ${selected?.name} does not track it, so ahead and behind are unknown`}>On {sync.remote}/{sync.branch}, not tracked</span>
        <button type="button" className={cn(countClass, 'text-foreground/80')} disabled={busy || !selected} title={`Track ${sync.remote}/${sync.branch} as the upstream of ${selected?.name}`} onClick={() => { if (selected) mutation.mutate({ action: 'set-upstream', name: selected.name, remote: sync.remote, branch: sync.branch }); }}>Track</button>
      </span>;
      case 'gone': return <span className="truncate text-warning" title="The upstream branch no longer exists on the remote">Upstream gone</span>;
      case 'up-to-date': return <span className={cn('flex items-center gap-1 truncate text-muted-foreground', stale && 'opacity-60')} title={syncTitle}><Check className="size-3" />Up to date</span>;
      default: return <span className={cn('flex min-w-0 items-baseline gap-1.5', stale && 'opacity-60')} title={sync.kind === 'diverged' ? `${syncTitle}. Pull is fast-forward only; rebase to reconcile.` : syncTitle}>
        {sync.kind === 'diverged' && <span className="shrink-0 text-muted-foreground">Diverged</span>}
        {sync.ahead > 0 && <button type="button" className={cn(countClass, 'text-success')} disabled={busy || !canPush} onClick={openPush}>{sync.ahead} to push</button>}
        {sync.behind > 0 && <button type="button" className={cn(countClass, 'text-warning')} disabled={busy || !canPull} onClick={pull}>{sync.behind} to pull</button>}
      </span>;
    }
  })();
  // One quiet context line: checked-out branch (only while inspecting another),
  // upstream name, and fetch freshness with the fetch control beside it.
  const showCurrentBranch = selected && !selected.current && currentBranch;
  const context: ReactNode[] = [];
  if (showCurrentBranch) context.push(<button
    key="current"
    type="button"
    className="min-w-0 truncate rounded-sm text-left underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`View checked-out branch ${currentBranch.name}`}
    title={`View ${currentBranch.name} history without switching branches`}
    onClick={() => selectBranch(currentBranch.ref)}
  >Checked out: {currentBranch.name}</button>);
  if (selected?.upstream) context.push(<span key="upstream" className="min-w-0 truncate" title="Upstream">{refLabel(selected.upstream)}</span>);
  if (fetchRemote) context.push(<span key="fetch" className="flex shrink-0 items-center gap-0.5">
    <span title={data?.lastFetchedAt ? new Date(data.lastFetchedAt).toLocaleString() : 'This repository has not been fetched'}>{fetching ? `Fetching ${fetchRemote}…` : fetched}</span>
    <Button variant="ghost" size="icon-xs" className="size-5" aria-label={`Fetch ${fetchRemote}`} title={`Fetch ${fetchRemote}`} disabled={busy} onClick={() => mutation.mutate({ action: 'fetch', remote: fetchRemote })}><RefreshCw className={cn('size-3', fetching && 'animate-spin')} /></Button>
  </span>);

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
      <Popover open={pickerOpen} onOpenChange={(open) => { setPickerOpen(open); if (!open) setSearch(''); }}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" disabled={busy || !data} aria-label="Select branch history"><GitBranch data-icon="inline-start" /><span className="min-w-0 flex-1 truncate text-left">{selected?.name ?? data?.repository.branch ?? 'Branches'}</span><ChevronDown data-icon="inline-end" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0"><Command>
          <CommandInput placeholder="Find branch…" value={search} onValueChange={setSearch} />
          <CommandList><CommandEmpty>No branches</CommandEmpty>
            {showRecent && <CommandGroup heading="Recent">{recent.map((b) => pickerItem(b, b.name, `recent:${b.ref}`))}</CommandGroup>}
            {groupBranchesByPrefix(localBranches).map((group) => <CommandGroup key={group.label ?? ''} heading={group.label ?? 'Local'}>{group.items.map((b) => pickerItem(b, branchLabelInGroup(b.name, group.label), b.ref, !!group.label))}</CommandGroup>)}
            {remoteBranches.length > 0 && <CommandGroup heading="Remote">{remoteBranches.map((b) => pickerItem(b, b.name, b.ref))}</CommandGroup>}
          </CommandList>
        </Command></PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon-sm" aria-label="New branch" disabled={busy || !selected} onClick={() => { if (selected) { setCreateFrom(commit?.head ?? selected.head); setPushBranch(null); } }}><Plus /></Button>
      {busy && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Branch actions" disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {(data?.repository.remotes ?? []).map((remote) => <DropdownMenuItem key={remote} disabled={busy} onClick={() => mutation.mutate({ action: 'fetch', remote })}><Download />Fetch {remote}</DropdownMenuItem>)}
          {selected?.current && <DropdownMenuItem disabled={busy || !!rebase.error || !data?.repository.head} onClick={() => setRebaseOpen(true)}><GitBranch />Rebase…</DropdownMenuItem>}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={branches.isFetching} onClick={() => void branches.refetch()}>Refresh branches</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {rebase.data?.active && <button type="button" className="mx-2 mb-1.5 flex shrink-0 items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-left text-xs font-medium hover:bg-accent" onClick={() => setRebaseOpen(true)}>
      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">Rebase in progress — resolve conflicts, continue, or abort</span>
    </button>}
    {pendingPush && <PushProgress label={`Pushing ${pendingPush.input.sourceBranch} to ${pendingPush.input.remote}/${pendingPush.input.branch}`} startedAt={pendingPush.submittedAt} runHooks={pendingPush.input.runHooks !== false} />}
    {!pushBranch && lastPush?.status === 'error' && (() => {
      const failure = pushFailure(lastPush.error);
      return <div className="flex flex-col gap-1 px-3 pb-2"><p role="alert" className="text-xs text-destructive">Push failed: {failure.message}</p><GitOutput output={failure.output} /></div>;
    })()}
    {!pushBranch && lastPush?.result?.warning && <p role="alert" className="px-3 pb-2 text-xs text-destructive">{lastPush.result.warning}</p>}
    {rebase.error && <p role="alert" className="px-3 pb-1 text-xs text-destructive">Unable to read rebase state. <button type="button" className="underline underline-offset-2" onClick={() => void rebase.refetch()}>Retry</button></p>}
    {branches.isPending && <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton className="h-9 w-full" key={i} />)}</div>}
    {branches.error && <div className="p-3 text-xs text-destructive" role="alert">{branches.error.message} <Button size="sm" variant="ghost" onClick={() => void branches.refetch()}>Retry</Button></div>}
    {data && selected && !pushBranch && <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-1.5">
      <div className="flex min-w-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-baseline text-xs">{syncStatus}</div>
        {selected.kind === 'local' && (selected.current ? <>
          <Button variant="ghost" size="sm" disabled={busy || !canPull} title={data.repository.upstream ? `Pull ${data.repository.upstream.remote}/${data.repository.upstream.branch} (fast-forward only)` : 'Configure an upstream on the server to pull'} onClick={pull}>{busy && mutation.variables?.action === 'pull' ? 'Pulling…' : 'Pull'}</Button>
          <Button variant="ghost" size="sm" disabled={busy || !canPush} onClick={openPush}>Push…</Button>
        </> : <>
          <Button variant="ghost" size="sm" disabled={busy || !canPull} title={selected.checkedOut ? 'Pull from the worktree where this branch is checked out' : selected.upstream?.startsWith('refs/remotes/') ? `Fetch and fast-forward ${selected.name} without switching branches` : 'Configure a remote upstream on the server to pull'} onClick={pull}>{busy && mutation.variables?.action === 'pull-branch' ? 'Pulling…' : 'Pull'}</Button>
          <Button variant="ghost" size="sm" disabled={busy || selected.checkedOut} onClick={() => { if (selected && data) mutation.mutate({ action: 'switch', name: selected.name, expectedBranch: data.repository.branch, expectedHead: data.repository.head, targetHead: selected.head }); }}>Switch</Button>
        </>)}
        {selected.kind === 'remote' && (() => {
          const target = resolveCheckout(selected);
          return <Button variant="ghost" size="sm" disabled={busy || !data.repository.head || !target} title={target?.existing ? `Switch to existing local branch ${target.localName}` : `Create ${target?.localName ?? ''} tracking ${selected.name}, then switch to it`} onClick={() => void checkoutRemote(selected)}>{busy && (mutation.variables?.action === 'track' || mutation.variables?.action === 'switch') ? 'Checking out…' : 'Checkout'}</Button>;
        })()}
      </div>
      {context.length > 0 && <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        {context.flatMap((node, index) => index ? [<span key={`sep-${index}`} aria-hidden="true">·</span>, node] : [node])}
      </div>}
    </div>}
    {createFrom && <form className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 px-2 py-2" onSubmit={(event) => { event.preventDefault(); if (createFrom && name.trim() && !busy) mutation.mutate({ action: 'create', name: name.trim(), startHead: createFrom }); }}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">New branch from <span className="font-mono">{createFrom.slice(0, 8)}</span>. Checkout stays unchanged.</span>
        <Button type="button" size="icon-xs" variant="ghost" aria-label="Cancel new branch" disabled={busy} onClick={() => { setCreateFrom(null); setName(''); }}><X /></Button>
      </div>
      <div className="flex items-center gap-1.5">
        <Input autoFocus aria-label="New branch name" placeholder="Branch name" className="h-7 flex-1" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} onKeyDown={(event) => { if (event.key === 'Escape') { setCreateFrom(null); setName(''); } }} />
        <Button type="submit" size="sm" className="shrink-0" disabled={busy || !name.trim()}>Create</Button>
      </div>
    </form>}
    {mutation.error && (() => {
      const failure = pushFailure(mutation.error);
      return <div className="flex flex-col gap-1 px-3 py-2"><p role="alert" className="text-xs text-destructive">{mutation.error.message}</p><GitOutput output={failure.output} /></div>;
    })()}
    {mutation.data?.warning && <p role="alert" className="px-3 py-2 text-xs text-destructive">{mutation.data.warning}</p>}
    {pushBranch && data ? <BranchPush key={`${pushBranch.ref}:${pushBranch.head}`} sdkClient={sdkClient} serverId={serverId} workspaceId={workspaceId} root={root} source={pushBranch} remotes={data.repository.remotes} onClose={() => setPushBranch(null)} onChanged={refresh} /> : commit ? <CommitDetails key={commit.head} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} entry={commit} onBack={() => setCommit(null)} /> : selected && data ? <BranchHistory key={selected.head} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} head={selected.head} upstream={selected.upstream} branches={data.branches} selected={selected} now={now} onSelect={setCommit} /> : data && <p className="p-3 text-xs text-muted-foreground">{selectedRef ? 'This branch no longer exists. Choose another branch.' : 'No commits yet. Create the first commit in Changes.'}</p>}
  </div>;
}

/** Vertical rail segment; `top`/`bottom` draw the line into neighbouring rows. */
function Rail({ top, bottom, title, children }: { top: boolean; bottom: boolean; title?: string; children?: ReactNode }) {
  return <span aria-hidden="true" title={title} className="relative flex w-3 shrink-0 items-center justify-center self-stretch">
    {top && <span className="absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-border" />}
    {bottom && <span className="absolute bottom-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-border" />}
    {children}
  </span>;
}

const syncHint = { ahead: 'Not on upstream yet, push to publish', behind: 'On upstream only, pull to get' } as const;

function CommitNode({ entry }: { entry: HistoryEntry }) {
  if (entry.parents.length > 1) {
    return <GitMerge className={cn('relative size-3 bg-background', entry.sync === 'ahead' ? 'text-success' : entry.sync === 'behind' ? 'text-warning' : 'text-muted-foreground')} />;
  }
  return <span className={cn('relative size-2 rounded-full', entry.sync === 'ahead' ? 'border-[1.5px] border-success bg-background' : entry.sync === 'behind' ? 'border-[1.5px] border-warning bg-warning/30' : 'bg-muted-foreground/60')} />;
}

const MAX_CHIPS = 2;

function RefChips({ refs }: { refs: GitBranchInfo[] }) {
  if (refs.length === 0) return null;
  const shown = refs.slice(0, MAX_CHIPS);
  return <span className="flex shrink-0 items-center gap-1">
    {shown.map((b) => <span key={b.ref} title={b.current ? `${b.name} (checked out)` : b.name} className={cn('max-w-28 truncate rounded px-1 text-[10px] leading-4', b.kind === 'remote' ? 'border border-border text-muted-foreground' : b.current ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground/80')}>{b.name}</span>)}
    {refs.length > MAX_CHIPS && <span className="text-[10px] text-muted-foreground" title={refs.slice(MAX_CHIPS).map((b) => b.name).join(', ')}>+{refs.length - MAX_CHIPS}</span>}
  </span>;
}

function BranchHistory({ sdkClient, workspaceId, serverId, root, head, upstream, branches, selected, now, onSelect }: Props & { sdkClient: ProkopaiClient; head: string; upstream?: string | null; branches: GitBranchInfo[]; selected: GitBranchInfo; now: number; onSelect: (entry: HistoryEntry) => void }) {
  const history = useInfiniteQuery({
    queryKey: ['git-history', serverId, workspaceId, root, head, upstream ?? null], initialPageParam: 0,
    queryFn: ({ pageParam }) => sdkClient.http.files.gitHistory(workspaceId, { root, head, offset: pageParam, upstream }),
    getNextPageParam: (page) => page.nextOffset ?? undefined, retry: false,
  });
  const commits = history.data?.pages.flatMap((page) => page.commits) ?? [];
  const chips = useMemo(() => refsByHead(branches, selected), [branches, selected]);
  const upstreamBranch = upstream ? branches.find((b) => b.ref === upstream) : undefined;
  const rows = buildHistoryRows(commits, now, upstreamBranch ? { ref: upstreamBranch.ref, head: upstreamBranch.head } : null, !history.hasNextPage);
  return <div className="dialog-scrollbar @container min-h-0 flex-1 overflow-y-auto pb-1">
    {rows.map((row, index) => {
      // Only the leading day heading sits above every commit; later ones bridge the rail.
      if (row.type === 'day') return <div key={row.key} className="sticky top-0 z-10 flex h-6 items-center gap-2 bg-background px-3">
        <Rail top={index > 0} bottom={index > 0} />
        <span className="text-[10px] font-medium text-muted-foreground/70">{row.label}</span>
      </div>;
      if (row.type === 'upstream') return <div key={row.key} className="flex h-5 items-center gap-2 px-3" title={`${row.label} points at the commit below`}>
        <Rail top bottom />
        <span className="flex-1 border-t border-dashed border-border" />
        <span className="max-w-[60%] shrink-0 truncate text-[10px] text-muted-foreground">{row.label}</span>
      </div>;
      const { entry, first, last } = row;
      // The divider already names the upstream on any row below the first.
      const refs = (chips.get(entry.head) ?? []).filter((b) => first || b.ref !== upstream);
      return <button type="button" key={row.key} className="group flex h-7 w-full min-w-0 items-center gap-2 px-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none" title={`${entry.subject}\n${entry.author} · ${new Date(entry.date).toLocaleString()}`} onClick={() => onSelect(entry)}>
        <Rail top={!first} bottom={!last} title={entry.sync ? syncHint[entry.sync] : undefined}><CommitNode entry={entry} /></Rail>
        {entry.sync && <span className="sr-only">{syncHint[entry.sync]}.</span>}
        <span className={cn('min-w-0 flex-1 truncate text-xs transition-colors group-hover:text-foreground', entry.sync ? 'text-foreground/80' : 'text-muted-foreground')}>{entry.subject}</span>
        <RefChips refs={refs} />
        <span className="hidden shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60 @xs:inline">{entry.head.slice(0, 7)}</span>
        <span className="min-w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/60">{relativeAge(entry.date, now)}</span>
      </button>;
    })}
    {history.isPending && <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton className="h-5 w-full" key={i} />)}</div>}
    {!history.isPending && commits.length === 0 && <p className="p-3 text-xs text-muted-foreground">No commits.</p>}
    {history.error && <p role="alert" className="p-3 text-xs text-destructive">{history.error.message}</p>}
    {history.hasNextPage && <Button className="m-2" variant="ghost" size="sm" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Load older commits</Button>}
  </div>;
}

function CommitDetails({ sdkClient, workspaceId, serverId, root, entry, onBack }: Props & { sdkClient: ProkopaiClient; entry: HistoryEntry; onBack: () => void }) {
  const { resolvedMode } = useTheme();
  const details = useQuery({ queryKey: ['git-commit-details', serverId, workspaceId, root, entry.head], queryFn: () => sdkClient.http.files.gitCommitDetails(workspaceId, { root, head: entry.head }), retry: false });
  return <div className="dialog-scrollbar min-h-0 flex-1 overflow-auto">
    <div className="px-2 py-1"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft data-icon="inline-start" />History</Button></div>
    <div className="flex flex-col gap-2 px-3 pb-3">
      <p className="text-sm font-medium">{entry.subject}</p>
      <p className="text-xs text-muted-foreground"><span className="shrink-0 font-mono tabular-nums">{entry.head.slice(0, 8)}</span> · {entry.author} · {entry.date.slice(0, 10)} · Diff against first parent</p>
      {details.isPending && <p className="text-xs text-muted-foreground">Loading commit…</p>}
      {details.error && <p role="alert" className="text-xs text-destructive">{details.error.message}</p>}
      {details.data && <>
        <details className="text-xs"><summary>{details.data.files.length} changed files</summary><ul className="py-1">{details.data.files.map((path) => <li key={path} className="truncate py-0.5">{path.split('/').pop()}<span className="ml-1.5 text-muted-foreground/70">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span></li>)}</ul></details>
        {details.data.patch ? <CommitPatch patch={details.data.patch} themeType={resolvedMode} /> : <p className="text-xs text-muted-foreground">No file changes</p>}
      </>}
    </div>
  </div>;
}

function BranchPush({ sdkClient, serverId, workspaceId, root, source, remotes, onClose, onChanged }: { sdkClient: ProkopaiClient; serverId?: string; workspaceId: string; root?: string; source: GitBranchInfo; remotes: string[]; onClose: () => void; onChanged: () => void }) {
  const upstream = source.upstream?.replace(/^refs\/remotes\//, '');
  const upstreamRemote = remotes.find((r) => upstream?.startsWith(`${r}/`));
  const [remote, setRemote] = useState(upstreamRemote ?? (remotes.length === 1 ? remotes[0] : ''));
  const [branch, setBranch] = useState(upstreamRemote ? upstream!.slice(upstreamRemote.length + 1) : source.name);
  const [review, setReview] = useState<{ target: GitBranchPushTarget; result: GitBranchPushReview } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [runHooks, setRunHooks] = useState(true);
  const inspect = useMutation({
    mutationFn: async (target: GitBranchPushTarget) => ({ target, result: await sdkClient.http.files.gitBranchPushReview(workspaceId, target) }),
    onSuccess: setReview, retry: false,
  });
  const push = useMutation({
    mutationKey: pushKey(serverId, workspaceId, root),
    mutationFn: (input: PushAction) => sdkClient.http.files.gitBranchAction(workspaceId, input), retry: false,
    onSuccess: onClose, onSettled: () => { setReview(null); onChanged(); },
  });
  const track = useMutation({
    mutationFn: (target: GitBranchPushTarget) => sdkClient.http.files.gitBranchAction(workspaceId, { action: 'set-upstream', root, name: target.sourceBranch, remote: target.remote, branch: target.branch }),
    retry: false, onSuccess: onClose, onSettled: onChanged,
  });
  const busy = inspect.isPending || push.isPending || track.isPending;
  const submit = (force: boolean) => {
    if (!review || busy) return;
    push.mutate({ ...review.target, action: 'push', force, expectedRemoteHead: review.result.remoteHead, runHooks });
  };
  const failure = push.error ? pushFailure(push.error) : null;
  const error = inspect.error ?? track.error;
  // Already on the remote but not tracked: tracking is what the user wants, with or without commits to push.
  const canTrack = !!review && !source.upstream && review.result.remoteHead !== null;
  return <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Push {source.name}</p>
        <div className="flex items-center gap-1">
          <p className="font-mono text-xs text-muted-foreground">{source.head.slice(0, 8)}</p>
          <Button variant="ghost" size="icon-xs" aria-label="Close push" disabled={busy} onClick={onClose}><X /></Button>
        </div>
      </div>
      <div className="flex gap-2">
        <select aria-label="Push remote" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs" value={remote} disabled={busy} onChange={(e) => { setRemote(e.target.value); setReview(null); }}><option value="">Choose remote</option>{remotes.map((r) => <option key={r}>{r}</option>)}</select>
        <Input aria-label="Destination branch" className="h-7 flex-1 text-xs" value={branch} disabled={busy} onChange={(e) => { setBranch(e.target.value); setReview(null); }} />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" disabled={busy || !remote || !branch.trim()} onClick={() => { setReview(null); inspect.mutate({ root, sourceBranch: source.name, expectedHead: source.head, remote, branch: branch.trim() }); }}>{inspect.isPending ? 'Reviewing…' : 'Review push'}</Button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error.message}</p>}
      {!error && failure && <div className="flex flex-col gap-1.5">
        <p role="alert" className="text-xs text-destructive">{failure.message}</p>
        <GitOutput output={failure.output} />
        {push.variables && canRetryWithoutHooks(failure, push.variables.runHooks !== false) && <div className="flex justify-end">
          <Button size="sm" variant="outline" disabled={busy} title="Push the same reviewed commit with --no-verify" onClick={() => { if (push.variables) push.mutate({ ...push.variables, runHooks: false }); }}>Push without hooks</Button>
        </div>}
      </div>}
      {review && <div className="flex flex-col gap-2 border-t border-border/60 pt-2.5">
        <p className="font-mono text-xs text-muted-foreground">{source.name} → {review.target.remote}/{review.target.branch}</p>
        <p className="text-xs text-muted-foreground">{review.result.outgoingCount} outgoing · {review.result.remoteOnlyCount} remote-only{review.result.outgoingCount === 0 && review.result.remoteOnlyCount === 0 ? ' · Nothing to push' : ''}</p>
        {review.result.outgoing.length > 0 && <ul className="text-xs">{review.result.outgoing.map((entry) => <li className="truncate py-0.5" key={entry.head} title={entry.subject}><span className="font-mono text-muted-foreground">{entry.head.slice(0, 8)}</span> {entry.subject}</li>)}</ul>}
        {review.result.remoteOnlyCount > 0 && <details className="text-xs"><summary className="text-muted-foreground">Remote commits that force push removes</summary><ul>{review.result.remoteOnly.map((entry) => <li className="truncate py-1" key={entry.head}>{entry.head.slice(0, 8)} {entry.subject}</li>)}</ul></details>}
        {(review.result.outgoingCount > 50 || review.result.remoteOnlyCount > 50) && <p className="text-xs text-muted-foreground">Showing the first 50 commits in each list.</p>}
        {canTrack && <p className="text-xs text-muted-foreground">{review.target.remote}/{review.target.branch} already exists, but {source.name} does not track it.</p>}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={runHooks} disabled={busy} onCheckedChange={(checked) => setRunHooks(checked === true)} />
          Run pre-push hooks
        </label>
        <div className="flex flex-wrap justify-end gap-1">
          {canTrack && <Button size="sm" variant={review.result.outgoingCount ? 'ghost' : 'default'} disabled={busy} title={`Set ${review.target.remote}/${review.target.branch} as the upstream without pushing`} onClick={() => track.mutate(review.target)}>{track.isPending ? 'Tracking…' : review.result.outgoingCount ? 'Track only' : 'Track'}</Button>}
          <Button size="sm" variant="ghost" disabled={busy || (!review.result.outgoingCount && !review.result.remoteOnlyCount)} onClick={() => setConfirm(true)}>Force with lease…</Button>
          {(review.result.outgoingCount > 0 || !canTrack) && <Button size="sm" disabled={busy || !review.result.outgoingCount || review.result.remoteOnlyCount > 0} onClick={() => submit(false)}>{push.isPending ? 'Pushing…' : 'Push commits'}</Button>}
        </div>
      </div>}
    </div>
    <ConfirmationDialog open={confirm} onOpenChange={(open) => { if (!open) setConfirm(false); }} title="Force push this branch?" description={`Replace ${remote}/${branch} at ${review?.result.remoteHead?.slice(0, 8) ?? 'a missing branch'} with ${source.head.slice(0, 8)}. ${review?.result.remoteOnlyCount ?? 0} remote-only commits will no longer be on this branch. A changed remote lease rejects the push.`} confirmLabel="Force push" variant="destructive" onConfirm={() => submit(true)} />
  </div>;
}
