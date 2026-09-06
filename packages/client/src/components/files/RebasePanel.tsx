import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import type { GitBranchesResult, GitRebaseConflict, GitRebaseResolution, GitRebaseState, ProkopaiClient } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { MergePane, RebaseConflictHunks } from './RebaseConflictHunks';
import { conflictSections, hasConflictMarkers } from './rebaseConflictSections';

export const rebaseKey = (serverId: string | undefined, workspaceId: string, root: string | undefined) => ['git-rebase', serverId, workspaceId, root] as const;
interface Props {
  sdkClient: ProkopaiClient;
  serverId?: string;
  workspaceId: string;
  root?: string;
  branches?: GitBranchesResult;
  onClose: () => void;
  onChanged: () => void;
}
export function RebasePanel({ sdkClient, serverId, workspaceId, root, branches, onClose, onChanged }: Props) {
  const cache = useQueryClient();
  const [baseRef, setBaseRef] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [abortToken, setAbortToken] = useState<string | null>(null);
  const key = rebaseKey(serverId, workspaceId, root);
  const status = useQuery({ queryKey: key, queryFn: () => sdkClient.http.files.gitRebaseState(workspaceId, { root }), retry: false });
  const state = status.data;
  const base = branches?.branches.find((b) => b.ref === baseRef && b.kind === 'local' && !b.current);
  const chosenPath = path && state?.conflicts.includes(path) ? path : state?.conflicts[0];
  const conflict = useQuery({
    queryKey: [...key, 'conflict', chosenPath],
    queryFn: () => { if (!chosenPath) throw new Error('Select a conflict'); return sdkClient.http.files.gitRebaseConflict(workspaceId, { root, path: chosenPath }); },
    enabled: !!state?.active && !!chosenPath, retry: false,
  });
  const action = useMutation({
    mutationFn: (run: () => Promise<GitRebaseState>) => run(), retry: false,
    onSuccess: (next) => {
      cache.setQueryData(key, next);
      setAbortToken(null);
      if (!next.active) { toast.success('Rebase finished'); onClose(); }
    },
    onSettled: () => { void cache.invalidateQueries({ queryKey: key }); onChanged(); },
  });
  const busy = action.isPending;
  const start = () => {
    if (!base || !branches?.repository.branch || !branches.repository.head || state?.active || busy) return;
    const input = { root, expectedBranch: branches.repository.branch, expectedHead: branches.repository.head, baseBranch: base.name, baseHead: base.head };
    action.mutate(() => sdkClient.http.files.gitRebaseStart(workspaceId, input));
  };
  const resolve = (input: GitRebaseResolution) => {
    if (!busy) action.mutate(() => sdkClient.http.files.gitRebaseResolve(workspaceId, { ...input, root }));
  };
  return <section className="flex min-h-0 flex-1 flex-col" aria-label="Rebase">
    <div className="flex shrink-0 items-center justify-between gap-2 p-2">
      <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}><ArrowLeft data-icon="inline-start" />Branches</Button>
      <Button variant="ghost" size="sm" disabled={busy || status.isFetching} onClick={() => { void status.refetch(); if (chosenPath) void conflict.refetch(); }}>Refresh</Button>
    </div>
    <div className="dialog-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {status.isPending && <p className="text-xs text-muted-foreground">Checking rebase state…</p>}
      {[status.error, action.error, conflict.error].filter(Boolean).map((error, i) => <Alert variant="destructive" key={i}><AlertDescription>{error?.message}</AlertDescription></Alert>)}
      {state?.active ? <>
        <p className="break-all text-sm">Rebasing <strong>{state.branch ?? 'detached HEAD'}</strong> onto <code>{state.onto?.slice(0, 8)}</code></p>
        <p className="text-xs text-muted-foreground">{state.conflicts.length ? `${state.conflicts.length} unresolved files. Save each resolution, then Continue.` : 'No unresolved files. Continue to replay the remaining commits.'}</p>
        {state.conflicts.length > 0 && <div className="flex flex-col gap-1" aria-label="Conflicting files">{state.conflicts.map((file) => <Button key={file} variant={chosenPath === file ? 'secondary' : 'ghost'} size="sm" className="justify-start" disabled={busy} onClick={() => setPath(file)}><span className="truncate">{file}</span></Button>)}</div>}
        {conflict.isFetching && chosenPath && <p className="text-xs text-muted-foreground">Loading conflict…</p>}
        {conflict.data && chosenPath && <ConflictEditor key={chosenPath} conflict={conflict.data} incomingLabel={`Incoming version · ${branches?.branches.find((b) => b.kind === 'local' && b.name !== state.branch && b.head === state.onto)?.name ?? state.onto?.slice(0, 8)}`} featureLabel={`Your change · ${state.branch ?? 'feature commit'}`} busy={busy} refreshing={conflict.isFetching} refreshError={conflict.error} onRetry={() => { void status.refetch(); void conflict.refetch(); }} onResolve={resolve} />}
      </> : state && <>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild><Button variant="outline" className="justify-between" disabled={busy} aria-label="Local base branch"><span className="truncate">{base?.name ?? 'Choose local base branch'}</span><ChevronDown data-icon="inline-end" /></Button></PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start"><Command><CommandInput placeholder="Find local branch…" /><CommandList><CommandEmpty>No other local branches</CommandEmpty><CommandGroup>{branches?.branches.filter((b) => b.kind === 'local' && !b.current).map((b) => <CommandItem key={b.ref} value={b.name} onSelect={() => { setBaseRef(b.ref); setPickerOpen(false); }}>{b.name}</CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
        </Popover>
        <p className="break-all text-sm">Rebase <strong>{branches?.repository.branch ?? 'current branch'}</strong> onto <strong>{base?.name ?? '…'}</strong></p>
        <p className="text-xs text-muted-foreground">Uses local commits only. The base branch stays unchanged. No fetch, stash or push. Replayed commit IDs change.</p>
        <Button disabled={busy || status.isFetching || !!status.error || !base || !branches?.repository.branch} onClick={start}>{busy ? 'Rebasing…' : 'Start rebase'}</Button>
      </>}
    </div>
    {state?.active && <div className="flex shrink-0 justify-between gap-2 border-t p-2">
      <Button variant="ghost" size="sm" disabled={busy || !state.token} onClick={() => setAbortToken(state.token)}>Abort rebase</Button>
      <Button size="sm" disabled={busy || !!status.error || state.conflicts.length > 0 || !state.token} onClick={() => {
        if (!state.token || busy) return;
        const token = state.token;
        action.mutate(() => sdkClient.http.files.gitRebaseControl(workspaceId, { root, action: 'continue', token }));
      }}>{busy ? 'Working…' : 'Continue'}</Button>
    </div>}
    <ConfirmationDialog open={abortToken !== null} onOpenChange={(open) => { if (!open) setAbortToken(null); }} title="Abort rebase?" description="Restore the feature branch to its pre-rebase commit. Resolutions and tracked-file edits made during this rebase will be discarded." confirmLabel="Abort rebase" variant="destructive" loading={busy} onConfirm={() => {
      if (!abortToken || busy) return;
      const token = abortToken;
      action.mutate(() => sdkClient.http.files.gitRebaseControl(workspaceId, { root, action: 'abort', token }));
    }} />
  </section>;
}
function ConflictEditor({ conflict, busy, refreshing, refreshError, onRetry, onResolve, incomingLabel, featureLabel }: { conflict: GitRebaseConflict; busy: boolean; refreshing: boolean; refreshError: Error | null; onRetry: () => void; onResolve: (input: GitRebaseResolution) => void; incomingLabel: string; featureLabel: string }) {
  const [draft, setDraft] = useState(conflict.workingText ?? '');
  const [reviewed, setReviewed] = useState(conflict);
  const [sectionMode] = useState(conflictSections(conflict.workingText ?? '').length > 0);
  // Repository tokens change when another file is staged. Only changes to this
  // file's versions or working bytes require the user to review it again.
  const stale = JSON.stringify([reviewed.base, reviewed.feature, reviewed.original, reviewed.workingText]) !== JSON.stringify([conflict.base, conflict.feature, conflict.original, conflict.workingText]);
  const blocked = busy || refreshing || !!refreshError || stale;
  const binary = conflict.base?.binary || conflict.feature?.binary;
  return <div className="flex flex-col gap-3">
    <p className="break-all text-xs">{conflict.path}</p>
    {refreshError && <Alert variant="destructive"><AlertDescription>Could not refresh this conflict: {refreshError.message}. Your draft is preserved.<Button variant="outline" size="sm" disabled={busy || refreshing} onClick={onRetry}>Retry conflict read</Button></AlertDescription></Alert>}
    {stale && <Alert><AlertDescription>Conflict changed on the server. Your draft is preserved. Review the current whole-file versions below before saving.<Button variant="outline" size="sm" disabled={busy || refreshing || !!refreshError} onClick={() => setReviewed(conflict)}>Use current versions, keep my draft</Button></AlertDescription></Alert>}
    {!binary && sectionMode && <RebaseConflictHunks fileName={conflict.path} incomingLabel={incomingLabel} featureLabel={featureLabel} draft={draft} disabled={blocked} onChange={setDraft} />}
    {conflict.original !== undefined && <details><summary className="cursor-pointer text-xs text-muted-foreground">Compare with original (common ancestor)</summary>{conflict.original?.text != null ? <MergePane title="Original file before either change" fileName={conflict.path} value={conflict.original.text} id={`${conflict.path}:original`} /> : <p className="text-xs text-muted-foreground">{conflict.original ? 'Original file is binary.' : 'File did not exist in the common ancestor.'}</p>}</details>}
    {!binary && <p className="text-xs text-muted-foreground" aria-live="polite">{hasConflictMarkers(draft) ? 'Resolve the highlighted sections before saving.' : 'No conflict markers remaining. Review the result, then save and stage.'}</p>}
    <details open={!!binary}><summary className="cursor-pointer text-xs text-muted-foreground">Whole-file versions and replacement actions</summary>
    {(['base', 'feature'] as const).map((side) => <div key={side} className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{side === 'base' ? 'Base being rebased onto' : 'Feature commit being replayed'}</p>
      {conflict[side]?.text != null ? <MergePane title={side === 'base' ? incomingLabel : featureLabel} fileName={conflict.path} value={conflict[side].text} id={`${conflict.path}:whole:${side}`} /> : <p className="text-xs text-muted-foreground">{conflict[side] ? 'Binary file' : 'Deleted on this side'}</p>}
      <Button variant="outline" size="sm" disabled={blocked} onClick={() => onResolve({ path: conflict.path, token: conflict.token, resolution: side })}>{conflict[side] ? `Use ${side} version` : `Keep ${side} deletion`}</Button>
    </div>)}
    </details>
    {!binary && <>{!sectionMode && <MergePane title="Result · editable" fileName={conflict.path} value={draft} id={`${conflict.path}:result`} onChange={setDraft} disabled={blocked} />}<Button disabled={blocked || hasConflictMarkers(draft)} onClick={() => onResolve({ path: conflict.path, token: conflict.token, resolution: 'text', text: draft })}>Save resolved file</Button></>}
    <details><summary className="cursor-pointer text-xs text-muted-foreground">Delete entire file…</summary><Button variant="ghost" size="sm" disabled={blocked} onClick={() => onResolve({ path: conflict.path, token: conflict.token, resolution: 'delete' })}>Delete file and stage resolution</Button></details>
  </div>;
}
