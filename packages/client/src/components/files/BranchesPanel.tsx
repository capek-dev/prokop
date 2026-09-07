import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Download, GitBranch, Loader2, MoreHorizontal, Plus, X } from 'lucide-react';
import { CommitPatch } from './CommitPatch';
import { RebasePanel, rebaseKey } from './RebasePanel';
import type { GitBranchAction, GitBranchInfo, GitBranchPushReview, GitBranchPushTarget, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/components/providers/ThemeProvider';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';
import { branchLabelInGroup, groupBranchesByPrefix } from './branchGroups';

interface Props {
  sdkClient: ProkopaiClient | null;
  serverId?: string;
  workspaceId: string;
  root?: string;
}
/** Shape of a git-history row (SDK type not exported; kept structural). */
interface HistoryEntry { head: string; subject: string; author: string; date: string }

export function BranchesPanel({ sdkClient, serverId, workspaceId, root }: Props) {
  const cache = useQueryClient();
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const selected = selectedRef ? data?.branches.find((b) => b.ref === selectedRef) : data?.branches.find((b) => b.current) ?? data?.branches[0];
  const refresh = () => {
    for (const key of [['git-branches'], ['git-repository'], ['git-rebase'], queryKeys.files.treePrefix, queryKeys.files.browsePrefix, queryKeys.files.gitStatusPrefix, ['files', 'git-diff'], queryKeys.worktrees.refsByWorkspace(workspaceId)]) {
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
  const busy = mutation.isPending || rebase.isPending || !!rebase.data?.active;
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
  if (!sdkClient) return <p className="p-3 text-xs text-muted-foreground">Connect to a server to manage branches.</p>;
  if (rebaseOpen) return <RebasePanel sdkClient={sdkClient} serverId={serverId} workspaceId={workspaceId} root={root} branches={data} onClose={() => setRebaseOpen(false)} onChanged={refresh} />;

  // One quiet meta line for the selected branch; checked-out context only when
  // the user is inspecting a different branch than the one that is active.
  const metaParts: string[] = [];
  if (selected && !selected.current && data?.repository.branch) metaParts.push(`Checked out: ${data.repository.branch}`);
  if (!selected?.upstream) {
    if (selected?.kind === 'remote') metaParts.push('Remote branch history');
    else if (selected) metaParts.push('No upstream');
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 px-2 py-1.5">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" disabled={busy || !data} aria-label="Select branch history"><GitBranch data-icon="inline-start" /><span className="min-w-0 flex-1 truncate text-left">{selected?.name ?? data?.repository.branch ?? 'Branches'}</span><ChevronDown data-icon="inline-end" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0"><Command>
          <CommandInput placeholder="Find branch…" />
          <CommandList><CommandEmpty>No branches</CommandEmpty>
            {groupBranchesByPrefix(data?.branches.filter((b) => b.kind === 'local') ?? []).map((group) => <CommandGroup key={group.label ?? ''} heading={group.label ?? 'Local'}>{group.items.map((b) => <CommandItem key={b.ref} value={b.ref} onSelect={() => { setSelectedRef(b.ref); setCommit(null); setCreateFrom(null); setPushBranch(null); setPickerOpen(false); }}>
              <span className={cn('min-w-0 flex-1 truncate', group.label && 'pl-4')}>{branchLabelInGroup(b.name, group.label)}</span>{b.current ? <Check /> : b.checkedOut ? <span className="text-xs text-muted-foreground">In use</span> : null}
            </CommandItem>)}</CommandGroup>)}
            {(data?.branches.some((b) => b.kind === 'remote') ?? false) && <CommandGroup heading="Remote">{data!.branches.filter((b) => b.kind === 'remote').map((b) => <CommandItem key={b.ref} value={b.ref} onSelect={() => { setSelectedRef(b.ref); setCommit(null); setCreateFrom(null); setPushBranch(null); setPickerOpen(false); }}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
            </CommandItem>)}</CommandGroup>}
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
    {rebase.error && <p role="alert" className="px-3 pb-1 text-xs text-destructive">Unable to read rebase state. <button type="button" className="underline underline-offset-2" onClick={() => void rebase.refetch()}>Retry</button></p>}
    {branches.isPending && <div className="flex flex-col gap-2 p-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton className="h-9 w-full" key={i} />)}</div>}
    {branches.error && <div className="p-3 text-xs text-destructive" role="alert">{branches.error.message} <Button size="sm" variant="ghost" onClick={() => void branches.refetch()}>Retry</Button></div>}
    {data && selected && !pushBranch && <div className="flex shrink-0 items-center gap-1 px-3 pb-1.5">
      {selected.upstream ? <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-xs text-muted-foreground" title="Counts relative to last fetched upstream">
        {metaParts.length > 0 && <span className="truncate">{metaParts.join(' · ')}</span>}
        <span className="min-w-0 truncate">{selected.upstream.replace('refs/remotes/', '')}</span>
        <span className={cn('shrink-0 font-medium tabular-nums', selected.ahead ? 'text-success' : 'text-muted-foreground/60')}>↑{selected.ahead ?? '?'}</span>
        <span className={cn('shrink-0 font-medium tabular-nums', selected.behind ? 'text-warning' : 'text-muted-foreground/60')}>↓{selected.behind ?? '?'}</span>
      </span> : <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{metaParts.join(' · ')}</span>}
      {selected.kind === 'local' && (selected.current ? <>
        <Button variant="ghost" size="sm" disabled={busy || !data.repository.upstream || !data.repository.head} title={data.repository.upstream ? `Pull ${data.repository.upstream.remote}/${data.repository.upstream.branch} (fast-forward only)` : 'Configure an upstream on the server to pull'} onClick={() => {
          if (busy || !data?.repository.branch || !data.repository.head || !data.repository.upstream) return;
          mutation.mutate({ action: 'pull', expectedBranch: data.repository.branch, expectedHead: data.repository.head, ...data.repository.upstream });
        }}>{busy && mutation.variables?.action === 'pull' ? 'Pulling…' : 'Pull'}</Button>
        <Button variant="ghost" size="sm" disabled={busy || !data?.repository.remotes.length} onClick={() => { if (selected) { setPushBranch(selected); setCreateFrom(null); } }}>Push…</Button>
      </> : <Button variant="ghost" size="sm" disabled={busy || selected.checkedOut} onClick={() => { if (selected && data) mutation.mutate({ action: 'switch', name: selected.name, expectedBranch: data.repository.branch, expectedHead: data.repository.head, targetHead: selected.head }); }}>Switch</Button>)}
      {selected.kind === 'remote' && (() => {
        const target = resolveCheckout(selected);
        return <Button variant="ghost" size="sm" disabled={busy || !data.repository.head || !target} title={target?.existing ? `Switch to existing local branch ${target.localName}` : `Create ${target?.localName ?? ''} tracking ${selected.name}, then switch to it`} onClick={() => void checkoutRemote(selected)}>{busy && (mutation.variables?.action === 'track' || mutation.variables?.action === 'switch') ? 'Checking out…' : 'Checkout'}</Button>;
      })()}
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
    {mutation.error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{mutation.error.message}</p>}
    {mutation.data?.warning && <p role="alert" className="px-3 py-2 text-xs text-destructive">{mutation.data.warning}</p>}
    {pushBranch && data ? <BranchPush key={`${pushBranch.ref}:${pushBranch.head}`} sdkClient={sdkClient} workspaceId={workspaceId} root={root} source={pushBranch} remotes={data.repository.remotes} onClose={() => setPushBranch(null)} onChanged={refresh} /> : commit ? <CommitDetails key={commit.head} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} entry={commit} onBack={() => setCommit(null)} /> : selected ? <BranchHistory key={selected.head} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} head={selected.head} upstream={selected.upstream} onSelect={setCommit} /> : data && <p className="p-3 text-xs text-muted-foreground">{selectedRef ? 'This branch no longer exists. Choose another branch.' : 'No commits yet. Create the first commit in Changes.'}</p>}
  </div>;
}

function BranchHistory({ sdkClient, workspaceId, serverId, root, head, upstream, onSelect }: Props & { sdkClient: ProkopaiClient; head: string; upstream?: string | null; onSelect: (entry: HistoryEntry) => void }) {
  const history = useInfiniteQuery({
    queryKey: ['git-history', serverId, workspaceId, root, head, upstream ?? null], initialPageParam: 0,
    queryFn: ({ pageParam }) => sdkClient.http.files.gitHistory(workspaceId, { root, head, offset: pageParam, upstream }),
    getNextPageParam: (page) => page.nextOffset ?? undefined, retry: false,
  });
  const commits = history.data?.pages.flatMap((page) => page.commits) ?? [];
  return <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto py-1">
    {commits.map((entry) => <button type="button" key={entry.head} className="group flex w-full min-w-0 items-baseline gap-2 px-3 py-1 text-left hover:bg-muted/50" onClick={() => onSelect(entry)}>
      {entry.sync && <span title={entry.sync === 'ahead' ? 'Not on upstream yet — push to publish' : 'On upstream only — pull to get'} className={cn('size-1.5 shrink-0 self-center rounded-full', entry.sync === 'ahead' ? 'bg-success' : 'bg-warning')} />}
      <span className={cn('min-w-0 flex-1 truncate text-xs transition-colors group-hover:text-foreground', entry.sync ? 'text-foreground/80' : 'text-muted-foreground')}>{entry.subject}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/60">{entry.head.slice(0, 7)}</span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60" title={entry.date.slice(0, 10)}>{entry.date.slice(5, 10)}</span>
    </button>)}
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
        <details className="text-xs"><summary className="cursor-pointer">{details.data.files.length} changed files</summary><ul className="py-1">{details.data.files.map((path) => <li key={path} className="truncate py-0.5">{path.split('/').pop()}<span className="ml-1.5 text-muted-foreground/70">{path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''}</span></li>)}</ul></details>
        {details.data.patch ? <CommitPatch patch={details.data.patch} themeType={resolvedMode} /> : <p className="text-xs text-muted-foreground">No file changes</p>}
      </>}
    </div>
  </div>;
}

function BranchPush({ sdkClient, workspaceId, root, source, remotes, onClose, onChanged }: { sdkClient: ProkopaiClient; workspaceId: string; root?: string; source: GitBranchInfo; remotes: string[]; onClose: () => void; onChanged: () => void }) {
  const upstream = source.upstream?.replace(/^refs\/remotes\//, '');
  const upstreamRemote = remotes.find((r) => upstream?.startsWith(`${r}/`));
  const [remote, setRemote] = useState(upstreamRemote ?? (remotes.length === 1 ? remotes[0] : ''));
  const [branch, setBranch] = useState(upstreamRemote ? upstream!.slice(upstreamRemote.length + 1) : source.name);
  const [review, setReview] = useState<{ target: GitBranchPushTarget; result: GitBranchPushReview } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const inspect = useMutation({
    mutationFn: async (target: GitBranchPushTarget) => ({ target, result: await sdkClient.http.files.gitBranchPushReview(workspaceId, target) }),
    onSuccess: setReview, retry: false,
  });
  const push = useMutation({
    mutationFn: (input: GitBranchAction) => sdkClient.http.files.gitBranchAction(workspaceId, input), retry: false,
    onSuccess: onClose, onSettled: () => { setReview(null); onChanged(); },
  });
  const busy = inspect.isPending || push.isPending;
  const submit = (force: boolean) => {
    if (!review || busy) return;
    push.mutate({ ...review.target, action: 'push', force, expectedRemoteHead: review.result.remoteHead });
  };
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
      {(inspect.error || push.error) && <p role="alert" className="text-xs text-destructive">{inspect.error?.message ?? push.error?.message}</p>}
      {review && <div className="flex flex-col gap-2 border-t border-border/60 pt-2.5">
        <p className="font-mono text-xs text-muted-foreground">{source.name} → {review.target.remote}/{review.target.branch}</p>
        <p className="text-xs text-muted-foreground">{review.result.outgoingCount} outgoing · {review.result.remoteOnlyCount} remote-only{review.result.outgoingCount === 0 && review.result.remoteOnlyCount === 0 ? ' · Nothing to push' : ''}</p>
        {review.result.outgoing.length > 0 && <ul className="text-xs">{review.result.outgoing.map((entry) => <li className="truncate py-0.5" key={entry.head} title={entry.subject}><span className="font-mono text-muted-foreground">{entry.head.slice(0, 8)}</span> {entry.subject}</li>)}</ul>}
        {review.result.remoteOnlyCount > 0 && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Remote commits that force push removes</summary><ul>{review.result.remoteOnly.map((entry) => <li className="truncate py-1" key={entry.head}>{entry.head.slice(0, 8)} {entry.subject}</li>)}</ul></details>}
        {(review.result.outgoingCount > 50 || review.result.remoteOnlyCount > 50) && <p className="text-xs text-muted-foreground">Showing the first 50 commits in each list.</p>}
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={busy || (!review.result.outgoingCount && !review.result.remoteOnlyCount)} onClick={() => setConfirm(true)}>Force with lease…</Button>
          <Button size="sm" disabled={busy || !review.result.outgoingCount || review.result.remoteOnlyCount > 0} onClick={() => submit(false)}>{push.isPending ? 'Pushing…' : 'Push commits'}</Button>
        </div>
      </div>}
    </div>
    <ConfirmationDialog open={confirm} onOpenChange={(open) => { if (!open) setConfirm(false); }} title="Force push this branch?" description={`Replace ${remote}/${branch} at ${review?.result.remoteHead?.slice(0, 8) ?? 'a missing branch'} with ${source.head.slice(0, 8)}. ${review?.result.remoteOnlyCount ?? 0} remote-only commits will no longer be on this branch. A changed remote lease rejects the push.`} confirmLabel="Force push" variant="destructive" onConfirm={() => submit(true)} />
  </div>;
}
