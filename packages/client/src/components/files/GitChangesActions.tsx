import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, GitCommitHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import type { GitDiffSummary, GitPushInput, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EMPTY_GIT_DRAFT, gitDraftKey, selectedGitPaths, useGitCommitStore } from '@/stores/gitCommitStore';
import { queryKeys } from '@/lib/queryKeys';
import { cn } from '@/lib/utils';

interface Props {
  sdkClient: ProkopaiClient;
  workspaceId: string;
  serverId?: string;
  root?: string;
  files: Array<{ path: string; git: GitDiffSummary }>;
  onPreview: (path: string) => void;
  children?: ReactNode;
}
type Mode = 'commit' | 'push' | 'force';
const labels: Record<Mode, string> = { commit: 'Commit', push: 'Commit & push', force: 'Commit & force push' };

/** Parent keys this component by server/workspace/root. */
export function GitChangesActions({ sdkClient, workspaceId, serverId, root, files, onPreview, children }: Props) {
  const queryClient = useQueryClient();
  const key = gitDraftKey(serverId, workspaceId, root);
  const draft = useGitCommitStore((state) => state.drafts[key] ?? EMPTY_GIT_DRAFT);
  const update = (patch: Partial<typeof draft>) => useGitCommitStore.getState().update(key, patch);
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>('commit');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState('');
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [retryPush, setRetryPush] = useState<GitPushInput | null>(null);
  const [confirmation, setConfirmation] = useState<GitPushInput | null>(null);
  const repository = useQuery({
    queryKey: ['git-repository', serverId, workspaceId, root],
    queryFn: ({ signal }) => sdkClient.http.files.gitRepository(workspaceId, { root, signal }),
    retry: false,
  });
  const selectable = files.filter((file) => file.git.status !== 'conflicted');
  const selected = selectedGitPaths(draft, selectable.map((file) => file.path));
  const selectedSet = new Set(selected);
  const visible = selectable.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase()));
  const destination = repository.data?.upstream ?? {
    remote: remote || (repository.data?.remotes.length === 1 ? repository.data.remotes[0] : ''),
    branch: branch || repository.data?.branch || '',
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['git-repository'] });
    for (const prefix of [queryKeys.files.gitStatusPrefix, queryKeys.files.browsePrefix, ['files', 'git-diff']]) {
      void queryClient.invalidateQueries({ queryKey: [...prefix, workspaceId] });
    }
  };
  const toggle = (paths: string[], checked: boolean) => {
    const next = new Set(selected);
    for (const path of paths) { if (checked) next.add(path); else next.delete(path); }
    update({ paths: [...next] });
  };
  const checkState = (paths: string[]): boolean | 'indeterminate' => {
    const count = paths.filter((path) => selectedSet.has(path)).length;
    return count === 0 ? false : count === paths.length ? true : 'indeterminate';
  };
  async function push(input: GitPushInput): Promise<void> {
    setPhase('Pushing…');
    setRetryPush(input);
    const result = await sdkClient.http.files.gitPush(workspaceId, input);
    setRetryPush(null);
    if (result.warning) setError(result.warning);
    else { toast.success('Committed and pushed'); setEditing(false); }
  }
  async function submit(reviewedForce?: GitPushInput): Promise<void> {
    if (busy || !selected.length || !draft.message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const state = await sdkClient.http.files.gitRepository(workspaceId, { root });
      if (!state.branch) throw new Error('Switch to a branch first.');
      if (reviewedForce && (state.head !== reviewedForce.expectedHead || state.branch !== reviewedForce.expectedBranch)) throw new Error('Branch changed. Review the force push again.');
      if (mode !== 'commit' && (!destination.remote || !destination.branch)) throw new Error('Choose a remote and destination branch.');
      if (mode === 'force' && !reviewedForce) {
        if (!state.head) throw new Error('Use Commit & push to publish the first commit.');
        const preview = await sdkClient.http.files.gitPushPreview(workspaceId, { root, ...destination });
        setConfirmation({ root, ...destination, expectedHead: state.head, expectedBranch: state.branch, force: true, expectedRemoteHead: preview.remoteHead, setUpstream: !state.upstream });
        return;
      }
      setPhase('Committing…');
      const result = await sdkClient.http.files.gitCommit(workspaceId, { root, paths: selected, message: draft.message, runHooks: draft.runHooks ?? true, expectedHead: state.head, expectedBranch: state.branch });
      useGitCommitStore.getState().clear(key);
      if (result.warning) { setError(result.warning); return; }
      if (mode !== 'commit') {
        await push({ ...(reviewedForce ?? { root, ...destination, expectedBranch: state.branch, setUpstream: !state.upstream }), expectedHead: result.head });
      } else { toast.success(`Committed ${result.head.slice(0, 8)}`); setEditing(false); }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Git operation failed');
    } finally { setBusy(false); setPhase(''); refresh(); }
  }
  async function retry(): Promise<void> {
    if (busy || !retryPush) return;
    setBusy(true);
    setError(null);
    try { await push(retryPush); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Push failed'); }
    finally { setBusy(false); setPhase(''); refresh(); }
  }
  // Build the selection view from the existing changed paths, with directory
  // toggles selecting descendants rather than a second grouped file browser.
  const rows: Array<{ path: string; directory: boolean; depth: number; file?: typeof files[number] }> = [];
  const directories = new Set<string>();
  for (const file of [...visible].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      if (!directories.has(path)) { directories.add(path); rows.push({ path, directory: true, depth: i - 1 }); }
    }
    rows.push({ path: file.path, directory: false, depth: parts.length - 1, file });
  }
  // Status letters follow the app-wide git-state convention (VSCode SCM):
  // M yellow, A/U green, D red, R muted.
  const STATUS_BADGE: Record<string, { letter: string; className: string }> = {
    modified: { letter: 'M', className: 'text-warning' },
    added: { letter: 'A', className: 'text-success' },
    untracked: { letter: 'U', className: 'text-success/80' },
    deleted: { letter: 'D', className: 'text-destructive' },
    renamed: { letter: 'R', className: 'text-muted-foreground' },
    copied: { letter: 'C', className: 'text-warning' },
  };
  // Filtering ignores collapses so matches are never hidden behind a folder.
  const hiddenBy = new Set(filter ? [] : collapsed);
  const isRowVisible = (row: { path: string }) => {
    for (const dir of hiddenBy) if (row.path.startsWith(`${dir}/`)) return false;
    return true;
  };
  const toggleDir = (path: string) => setCollapsed((current) => current.includes(path) ? current.filter((item) => item !== path) : [...current, path]);
  return <>
    <div className="flex shrink-0 items-center gap-1 px-2 py-1">
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{repository.data?.branch ?? (repository.isPending ? 'Loading Git…' : 'Git unavailable')}</span>
      <Button variant="ghost" size="sm" disabled={busy || !repository.data?.branch || (!editing && !selectable.length && !retryPush)} onClick={() => setEditing(!editing)}>
        {editing ? <X data-icon="inline-start" /> : <GitCommitHorizontal data-icon="inline-start" />}{editing ? 'Cancel' : 'Commit…'}
      </Button>
    </div>
    {!editing ? children : <>
      <div className="flex shrink-0 items-center gap-2 px-2 pb-1.5">
        <Checkbox aria-label="Select all matching files" className="size-3.5" disabled={busy || !!retryPush} checked={checkState(visible.map((file) => file.path))} onCheckedChange={(checked) => toggle(visible.map((file) => file.path), checked === true)} />
        <Input aria-label="Filter files to commit" className="h-7 flex-1 text-xs" placeholder="Filter files…" value={filter} onChange={(event) => setFilter(event.target.value)} disabled={busy} />
      </div>
      <div className="dialog-scrollbar min-h-0 flex-1 overflow-y-auto">
        {rows.filter(isRowVisible).map((row) => {
          const paths = row.directory ? visible.filter((file) => file.path.startsWith(`${row.path}/`)).map((file) => file.path) : [row.path];
          const status = row.file?.git.status;
          const badge = STATUS_BADGE[status ?? 'modified'] ?? STATUS_BADGE.modified;
          const collapsedRow = row.directory && hiddenBy.has(row.path);
          return <div key={`${row.directory}:${row.path}`} className="group flex min-w-0 items-center gap-1.5 py-1 pr-3 hover:bg-muted/50" style={{ paddingLeft: 10 + row.depth * 14 }}>
            <Checkbox aria-label={row.directory ? `Select directory ${row.path}` : `Commit ${row.path}`} className="size-3.5" checked={checkState(paths)} disabled={busy || !!retryPush} onCheckedChange={(checked) => toggle(paths, checked === true)} />
            {row.directory ? <>
              <button type="button" aria-label={collapsedRow ? `Expand directory ${row.path}` : `Collapse directory ${row.path}`} aria-expanded={!collapsedRow} className="shrink-0 text-muted-foreground/50 hover:text-foreground" onClick={() => toggleDir(row.path)}>
                {collapsedRow ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
              </button>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground/80 hover:text-foreground" onClick={() => toggleDir(row.path)}>{row.path.split('/').pop()}</button>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/50" title={`${paths.length} changed files`}>{paths.length}</span>
            </> : <>
              <button type="button" className="min-w-0 flex-1 truncate text-left text-xs" title={`Preview ${row.path}`} disabled={busy} onClick={() => onPreview(row.path)}>
                {row.path.split('/').pop()}
                {row.path.includes('/') && <span className="ml-1.5 text-muted-foreground/70">{row.path.slice(0, row.path.lastIndexOf('/'))}</span>}
              </button>
              <span className={cn('shrink-0 font-mono text-[10px] font-medium uppercase', badge.className)} title={status}>{badge.letter}</span>
            </>}
          </div>;
        })}
        {visible.length === 0 && <p className="px-3 py-4 text-xs text-muted-foreground">No matching files</p>}
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border/60 p-2">
        {retryPush ? <p className="text-xs text-muted-foreground">Committed {retryPush.expectedHead.slice(0, 8)}. Push has not completed.</p> : <Textarea aria-label="Commit message" className="min-h-14 text-xs" placeholder="Commit message" value={draft.message} rows={2} disabled={busy} maxLength={8192} onChange={(event) => update({ message: event.target.value })} />}
        {!retryPush && <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={draft.runHooks ?? true} disabled={busy} onCheckedChange={(checked) => update({ runHooks: checked === true })} />
          Run commit hooks
        </label>}
        {mode !== 'commit' && !retryPush && <>
          {!repository.data?.upstream && <div className="flex gap-2">
            <select aria-label="Remote" className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1 text-xs" value={destination.remote} disabled={busy} onChange={(event) => setRemote(event.target.value)}><option value="">Remote</option>{repository.data?.remotes.map((name) => <option key={name}>{name}</option>)}</select>
            <Input aria-label="Remote branch" className="h-7 flex-1 text-xs" value={destination.branch} disabled={busy} onChange={(event) => setBranch(event.target.value)} />
          </div>}
          <p className="text-xs text-muted-foreground" title="Push includes all unpushed branch commits, not only these files">{repository.data?.branch} → {destination.remote || 'remote'}/{destination.branch}</p>
        </>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{selected.length} selected</span>
          {retryPush ? <Button size="sm" disabled={busy} onClick={() => void retry()}>{busy ? phase : 'Retry push'}</Button> : <div className="flex items-center">
            <Button size="sm" disabled={busy || !selected.length || !draft.message.trim()} onClick={() => void submit()}>{busy ? phase : labels[mode]}</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Commit action" disabled={busy}><ChevronDown /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{(['commit', 'push', 'force'] as const).map((value) => <DropdownMenuItem key={value} disabled={value !== 'commit' && !repository.data?.remotes.length} onSelect={() => setMode(value)}>{labels[value]}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          </div>}
        </div>
      </div>
    </>}
    {(error || repository.error) && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error ?? repository.error?.message}</p>}
    <ConfirmationDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null); }} title="Commit and force push?" description={`Commit the selected files and replace ${confirmation?.remote}/${confirmation?.branch} at ${confirmation?.expectedRemoteHead?.slice(0, 8) ?? 'a missing branch'}. Remote commits can be removed. The push is rejected if the remote changes after this review.`} variant="destructive" confirmLabel="Commit & force push" onConfirm={() => { if (confirmation) void submit(confirmation); }} />
  </>;
}
