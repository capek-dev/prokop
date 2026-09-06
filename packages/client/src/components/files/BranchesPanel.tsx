import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ChevronDown, Download, GitBranch, Plus } from 'lucide-react';
import { CommitPatch } from './CommitPatch';
import { RebasePanel, rebaseKey } from './RebasePanel';
import type { GitBranchAction, GitBranchInfo, GitBranchPushReview, GitBranchPushTarget, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { useTheme } from '@/components/providers/ThemeProvider';
import { queryKeys } from '@/lib/queryKeys';

interface Props {
  sdkClient: ProkopaiClient | null;
  serverId?: string;
  workspaceId: string;
  root?: string;
}

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
  const [fetchRemote, setFetchRemote] = useState('');
  const [pushBranch, setPushBranch] = useState<GitBranchInfo | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const branches = useQuery({
    queryKey: ['git-branches', serverId, workspaceId, root],
    queryFn: () => { if (!sdkClient) throw new Error('Not connected'); return sdkClient.http.files.gitBranches(workspaceId, { root }); },
    enabled: !!sdkClient, retry: false,
  });
  const data = branches.data;
  const selected = selectedRef ? data?.branches.find((b) => b.ref === selectedRef) : data?.branches.find((b) => b.current) ?? data?.branches[0];
  const remote = fetchRemote || (data?.repository.remotes.length === 1 ? data.repository.remotes[0] : '');
  const refresh = () => {
    for (const key of [['git-branches'], ['git-repository'], ['git-rebase'], queryKeys.files.treePrefix, queryKeys.files.browsePrefix, queryKeys.files.gitStatusPrefix, ['files', 'git-diff'], queryKeys.worktrees.refsByWorkspace(workspaceId)]) {
      void cache.invalidateQueries({ queryKey: key });
    }
  };
  const mutation = useMutation({
    mutationFn: (input: GitBranchAction) => { if (!sdkClient) throw new Error('Not connected'); return sdkClient.http.files.gitBranchAction(workspaceId, { ...input, root }); },
    retry: false,
    onSuccess: (_result, input) => {
      if (input.action === 'create') { setCreateFrom(null); setName(''); setSelectedRef(`refs/heads/${input.name}`); setCommit(null); }
      if (input.action === 'switch' || input.action === 'pull') setCommit(null);
    },
    onSettled: refresh,
  });
  const busy = mutation.isPending || rebase.isPending || !!rebase.data?.active;
  if (!sdkClient) return <p className="p-3 text-xs text-muted-foreground">Connect to a server to manage branches.</p>;
  if (rebaseOpen) return <RebasePanel sdkClient={sdkClient} serverId={serverId} workspaceId={workspaceId} root={root} branches={data} onClose={() => setRebaseOpen(false)} onChanged={refresh} />;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-1 px-2 py-1">
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild><Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" disabled={busy || !data} aria-label="Select branch history"><GitBranch data-icon="inline-start" /><span className="truncate">{selected?.name ?? data?.repository.branch ?? 'Branches'}</span><ChevronDown data-icon="inline-end" /></Button></PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0"><Command>
          <CommandInput placeholder="Find branch…" />
          <CommandList><CommandEmpty>No branches</CommandEmpty>{(['local', 'remote'] as const).map((kind) => <CommandGroup heading={kind === 'local' ? 'Local' : 'Remote'} key={kind}>{data?.branches.filter((b) => b.kind === kind).map((b) => <CommandItem key={b.ref} value={b.ref} onSelect={() => { setSelectedRef(b.ref); setCommit(null); setCreateFrom(null); setPushBranch(null); setPickerOpen(false); }}>
            <span className="min-w-0 flex-1 truncate">{b.name}</span>{b.current ? <Check /> : b.checkedOut ? <span className="text-xs text-muted-foreground">In use</span> : null}
          </CommandItem>)}</CommandGroup>)}</CommandList>
        </Command></PopoverContent>
      </Popover>
      <Button variant="ghost" size="icon-sm" aria-label="New branch" disabled={busy || !selected} onClick={() => { if (selected) { setCreateFrom(commit ?? selected.head); setPushBranch(null); } }}><Plus /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Fetch remote" disabled={busy || !remote} onClick={() => mutation.mutate({ action: 'fetch', remote })}><Download /></Button>
    </div>
    {data && data.repository.remotes.length > 1 && <div className="px-3 pb-1"><label className="flex items-center gap-2 text-xs text-muted-foreground">Fetch from<select aria-label="Fetch remote name" className="min-w-0 flex-1 bg-transparent" value={remote} disabled={busy} onChange={(e) => setFetchRemote(e.target.value)}><option value="">Choose remote</option>{data.repository.remotes.map((r) => <option key={r}>{r}</option>)}</select></label></div>}
    {branches.isPending && <p className="p-3 text-xs text-muted-foreground">Loading branches…</p>}
    {branches.error && <div className="p-3 text-xs"><p role="alert">{branches.error.message}</p><Button size="sm" variant="ghost" onClick={() => void branches.refetch()}>Retry</Button></div>}
    {data && <p className="px-3 pb-1 text-xs text-muted-foreground">Checkout: {data.repository.branch ?? 'Detached HEAD'}{busy ? ' · Working…' : ''}</p>}
    {rebase.data?.active && <Button variant="secondary" size="sm" className="mx-2 mb-2" onClick={() => setRebaseOpen(true)}>Rebase in progress: resolve, Continue or Abort</Button>}
    {rebase.error && <p role="alert" className="px-3 text-xs text-destructive">Unable to read rebase state. <Button variant="ghost" size="sm" onClick={() => void rebase.refetch()}>Retry rebase status</Button></p>}
    {selected && !pushBranch && <div className="flex shrink-0 flex-wrap items-center gap-1 px-2 pb-1">
      <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground" title="Counts relative to last fetched upstream">{selected.upstream ? `${selected.upstream.replace('refs/remotes/', '')} · ↑${selected.ahead ?? '?'} ↓${selected.behind ?? '?'}` : selected.kind === 'remote' ? 'Remote branch history' : 'No upstream'}</span>
      {selected.kind === 'local' && <>
        {!selected.current && <Button variant="ghost" size="sm" disabled={busy || selected.checkedOut} onClick={() => { if (selected && data) mutation.mutate({ action: 'switch', name: selected.name, expectedBranch: data.repository.branch, expectedHead: data.repository.head, targetHead: selected.head }); }}>Switch</Button>}
        {selected.current && <Button variant="ghost" size="sm" disabled={busy || !!rebase.error || !data?.repository.head} onClick={() => setRebaseOpen(true)}>Rebase…</Button>}
        {selected.current && <Button variant="ghost" size="sm" disabled={busy || !data?.repository.upstream || !data.repository.head} title={data?.repository.upstream ? `Pull ${data.repository.upstream.remote}/${data.repository.upstream.branch} (fast-forward only)` : 'Configure an upstream on the server to pull'} onClick={() => {
          if (busy || !data?.repository.branch || !data.repository.head || !data.repository.upstream) return;
          mutation.mutate({ action: 'pull', expectedBranch: data.repository.branch, expectedHead: data.repository.head, ...data.repository.upstream });
        }}>{busy && mutation.variables?.action === 'pull' ? 'Pulling…' : 'Pull'}</Button>}
        <Button variant="ghost" size="sm" disabled={busy || !data?.repository.remotes.length} onClick={() => { if (selected) { setPushBranch(selected); setCreateFrom(null); } }}>Push…</Button>
      </>}
    </div>}
    {createFrom && <form className="flex shrink-0 flex-col gap-2 border-b p-3" onSubmit={(event) => { event.preventDefault(); if (createFrom && name.trim() && !busy) mutation.mutate({ action: 'create', name: name.trim(), startHead: createFrom }); }}>
      <p className="text-xs text-muted-foreground">New branch from {createFrom.slice(0, 8)}. Checkout stays unchanged.</p>
      <Input aria-label="New branch name" placeholder="Branch name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      <div className="flex justify-end gap-1"><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setCreateFrom(null)}>Cancel</Button><Button size="sm" disabled={busy || !name.trim()}>Create branch</Button></div>
    </form>}
    {mutation.error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{mutation.error.message}</p>}
    {mutation.data?.warning && <p role="alert" className="px-3 py-2 text-xs text-destructive">{mutation.data.warning}</p>}
    {pushBranch && data ? <BranchPush key={`${pushBranch.ref}:${pushBranch.head}`} sdkClient={sdkClient} workspaceId={workspaceId} root={root} source={pushBranch} remotes={data.repository.remotes} onClose={() => setPushBranch(null)} onChanged={refresh} /> : commit ? <CommitDetails key={commit} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} head={commit} onBack={() => setCommit(null)} /> : selected ? <BranchHistory key={selected.head} sdkClient={sdkClient} workspaceId={workspaceId} serverId={serverId} root={root} head={selected.head} onSelect={setCommit} /> : data && <p className="p-3 text-xs text-muted-foreground">{selectedRef ? 'This branch no longer exists. Choose another branch.' : 'No commits yet. Create the first commit in Changes.'}</p>}
  </div>;
}

function BranchHistory({ sdkClient, workspaceId, serverId, root, head, onSelect }: Props & { sdkClient: ProkopaiClient; head: string; onSelect: (head: string) => void }) {
  const history = useInfiniteQuery({
    queryKey: ['git-history', serverId, workspaceId, root, head], initialPageParam: 0,
    queryFn: ({ pageParam }) => sdkClient.http.files.gitHistory(workspaceId, { root, head, offset: pageParam }),
    getNextPageParam: (page) => page.nextOffset ?? undefined, retry: false,
  });
  return <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto">
    <p className="px-3 py-2 text-xs text-muted-foreground">History</p>
    {history.data?.pages.flatMap((page) => page.commits).map((entry) => <button type="button" key={entry.head} className="flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left hover:bg-muted/50" onClick={() => onSelect(entry.head)}>
      <span className="w-full truncate text-sm">{entry.subject}</span><span className="w-full truncate text-xs text-muted-foreground">{entry.head.slice(0, 8)} · {entry.author} · {entry.date.slice(0, 10)}</span>
    </button>)}
    {history.isPending && <p className="p-3 text-xs text-muted-foreground">Loading history…</p>}
    {history.error && <p role="alert" className="p-3 text-xs text-destructive">{history.error.message}</p>}
    {history.hasNextPage && <Button className="m-2" variant="ghost" size="sm" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Load older commits</Button>}
  </div>;
}
function CommitDetails({ sdkClient, workspaceId, serverId, root, head, onBack }: Props & { sdkClient: ProkopaiClient; head: string; onBack: () => void }) {
  const { resolvedMode } = useTheme();
  const details = useQuery({ queryKey: ['git-commit-details', serverId, workspaceId, root, head], queryFn: () => sdkClient.http.files.gitCommitDetails(workspaceId, { root, head }), retry: false });
  return <div className="dialog-scrollbar min-h-0 flex-1 overflow-auto">
    <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft data-icon="inline-start" />History</Button>
    <p className="px-3 py-1 text-xs text-muted-foreground">{head.slice(0, 8)} · Diff against first parent</p>
    {details.isPending && <p className="p-3 text-xs text-muted-foreground">Loading commit…</p>}
    {details.error && <p role="alert" className="p-3 text-xs text-destructive">{details.error.message}</p>}
    {details.data && <>
      <details className="px-3 py-2 text-xs"><summary>{details.data.files.length} changed files</summary><ul>{details.data.files.map((path) => <li key={path} className="break-all py-1">{path}</li>)}</ul></details>
      {details.data.patch ? <CommitPatch patch={details.data.patch} themeType={resolvedMode} /> : <p className="p-3 text-xs text-muted-foreground">No file changes</p>}
    </>}
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
    <div className="flex flex-col gap-2">
      <p className="break-all text-xs">Push {source.name} at {source.head.slice(0, 8)}</p>
      <label className="flex items-center gap-2 text-xs">Remote<select aria-label="Push remote" className="min-w-0 flex-1 rounded-md border bg-background p-1" value={remote} disabled={busy} onChange={(e) => { setRemote(e.target.value); setReview(null); }}><option value="">Choose remote</option>{remotes.map((r) => <option key={r}>{r}</option>)}</select></label>
      <Input aria-label="Destination branch" value={branch} disabled={busy} onChange={(e) => { setBranch(e.target.value); setReview(null); }} />
      <div className="flex justify-end gap-1"><Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="outline" size="sm" disabled={busy || !remote || !branch.trim()} onClick={() => { setReview(null); inspect.mutate({ root, sourceBranch: source.name, expectedHead: source.head, remote, branch: branch.trim() }); }}>{inspect.isPending ? 'Reviewing…' : 'Review push'}</Button></div>
      {(inspect.error || push.error) && <p role="alert" className="text-xs text-destructive">{inspect.error?.message ?? push.error?.message}</p>}
      {review && <>
        <p className="break-all text-xs">{source.name} → {review.target.remote}/{review.target.branch}</p>
        <p className="text-xs text-muted-foreground">{review.result.outgoingCount} outgoing · {review.result.remoteOnlyCount} remote-only</p>
        {review.result.outgoingCount === 0 && review.result.remoteOnlyCount === 0 && <p className="text-xs text-muted-foreground">Nothing to push</p>}
        <ul className="text-xs">{review.result.outgoing.map((entry) => <li className="truncate py-1" key={entry.head} title={entry.subject}>{entry.head.slice(0, 8)} {entry.subject}</li>)}</ul>
        {review.result.remoteOnlyCount > 0 && <details className="text-xs"><summary>Remote commits that force push removes</summary><ul>{review.result.remoteOnly.map((entry) => <li className="truncate py-1" key={entry.head}>{entry.head.slice(0, 8)} {entry.subject}</li>)}</ul></details>}
        {(review.result.outgoingCount > 50 || review.result.remoteOnlyCount > 50) && <p className="text-xs text-muted-foreground">Showing the first 50 commits in each list.</p>}
        <div className="flex flex-wrap justify-end gap-1">
          <Button size="sm" variant="ghost" disabled={busy || (!review.result.outgoingCount && !review.result.remoteOnlyCount)} onClick={() => setConfirm(true)}>Force with lease…</Button>
          <Button size="sm" disabled={busy || !review.result.outgoingCount || review.result.remoteOnlyCount > 0} onClick={() => submit(false)}>{push.isPending ? 'Pushing…' : 'Push commits'}</Button>
        </div>
      </>}
    </div>
    <ConfirmationDialog open={confirm} onOpenChange={setConfirm} title="Force push this branch?" description={`Replace ${remote}/${branch} at ${review?.result.remoteHead?.slice(0, 8) ?? 'a missing branch'} with ${source.head.slice(0, 8)}. ${review?.result.remoteOnlyCount ?? 0} remote-only commits will no longer be on this branch. A changed remote lease rejects the push.`} confirmLabel="Force push" variant="destructive" onConfirm={() => submit(true)} />
  </div>;
}
