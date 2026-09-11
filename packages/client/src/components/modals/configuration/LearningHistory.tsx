import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { LearningChange, LearningRunSummary } from '@prokopai/sdk';
import { useServerClient } from '@/contexts/ServerClientContext';
import { useServerDataStore } from '@/stores/serverDataStore';
import { DiffViewer } from '@/components/visualizations/DiffViewer';
import { generateDiff } from '@/utils/diff';
import { DisclosureRow } from './DisclosureRow';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const STATUS_META: Record<LearningRunSummary['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  running: { label: 'Running', variant: 'default' },
  completed: { label: 'Completed', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  interrupted: { label: 'Interrupted', variant: 'outline' },
};

function RunStatusBadge({ status }: { status: LearningRunSummary['status'] }) {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/** Patch view of a change, matching how file edits render elsewhere in the app. */
function ChangeDiff({ change }: { change: LearningChange }) {
  const { hunks, additions, deletions } = useMemo(() => {
    const result = generateDiff(change.before ?? '', change.after ?? '', change.path);
    const changes = result.hunks.flatMap(hunk => hunk.changes);
    return {
      hunks: result.hunks,
      additions: changes.filter(item => item.type === 'added').length,
      deletions: changes.filter(item => item.type === 'removed').length,
    };
  }, [change]);
  const fileState = change.before === null ? 'New file' : change.after === null ? 'File deleted' : null;
  return (
    <div className="flex flex-col gap-2">
      {fileState && <p className="text-xs text-muted-foreground">{fileState}</p>}
      {hunks.length
        ? <DiffViewer hunks={hunks} path={change.path} additions={additions} deletions={deletions} disablePathOpen vizKey={`learning-${change.id}`} />
        : <p className="text-sm text-muted-foreground">No content changes.</p>}
    </div>
  );
}

export function LearningHistory({ workspaceId }: { workspaceId: string }) {
  const { sdkClient: client, serverUrl } = useServerClient();
  const { serverId } = useParams({ strict: false });
  const cache = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const key = ['learning', workspaceId, serverUrl];
  const runs = useQuery({ queryKey: key, enabled: Boolean(client), queryFn: ({ signal }) => client!.http.workspaces.learningRuns(workspaceId, { signal }) });
  const detail = useQuery({ queryKey: [...key, runId], enabled: Boolean(client && runId), queryFn: ({ signal }) => client!.http.workspaces.learningRun(workspaceId, runId!, { signal }) });
  const mutation = useMutation({
    mutationFn: async (changeId: string) => {
      if (!client || !detail.data) throw new Error('Select a run first');
      const result = await client.http.workspaces.undoLearningChange(workspaceId, detail.data.run.id, changeId);
      if (result.result === 'conflict') throw new Error('File changed since learning. Undo did not overwrite it.');
    },
    onSettled: () => { void cache.invalidateQueries({ queryKey: key }); },
  });

  const workspaces = useServerDataStore(state => state.workspaces);
  const preconfigs = useServerDataStore(state => state.preconfigs);
  /** Saved settings, not the settings draft: history describes past runs. */
  const reviewerNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const reviewer of workspaces.find(w => w.id === workspaceId)?.settings?.learning?.reviewers ?? []) {
      map[reviewer.id] = preconfigs.find(p => p.id === reviewer.preconfigId)?.name ?? 'Unavailable preconfig';
    }
    return map;
  }, [workspaces, preconfigs, workspaceId]);
  const reviewerLabel = (id: string) => reviewerNameById[id] ?? 'Unavailable learner';
  const sessionTitle = (title: string | null | undefined) => title?.trim() || 'Untitled conversation';
  /** One row per conversation: sources are message-level and a run often reads several from the same conversation. */
  const sourceSessions = useMemo(() => {
    const order: string[] = [];
    const byId = new Map<string, { sessionId: string; title?: string | null; count: number }>();
    for (const source of detail.data?.sources ?? []) {
      const existing = byId.get(source.sessionId);
      if (existing) existing.count += 1;
      else { byId.set(source.sessionId, { sessionId: source.sessionId, title: source.title, count: 1 }); order.push(source.sessionId); }
    }
    return order.map(id => byId.get(id)!);
  }, [detail.data]);
  const sourcesSummary = sourceSessions.length
    ? `${sourceSessions.length} ${sourceSessions.length === 1 ? 'conversation' : 'conversations'}${detail.data && detail.data.sources.length > sourceSessions.length ? ` · ${detail.data.sources.length} messages` : ''}`
    : null;
  const back = () => { setRunId(null); mutation.reset(); };

  /** Run screen: the list unmounts, so the run reads as its own page with back navigation. */
  if (runId) {
    const error = detail.error ?? mutation.error;
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Button variant="ghost" size="sm" className="w-fit gap-1.5 px-2 text-muted-foreground" onClick={back}>
          <ArrowLeft className="size-4" /> Back to runs
        </Button>

        {detail.isPending && <p role="status" className="text-sm text-muted-foreground">Loading run...</p>}
        {error && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </p>
        )}

        {detail.data && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{new Date(detail.data.run.startedAt).toLocaleString()}</span>
                <p className="text-xs text-muted-foreground">Learner: {reviewerLabel(detail.data.run.reviewerId)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {serverId && detail.data.sessionId && (
                  <Link className="text-sm text-primary underline-offset-4 hover:underline"
                    to="/server/$serverId/workspace/session/$sessionId"
                    params={{ serverId, sessionId: detail.data.sessionId }}>
                    Open learning session
                  </Link>
                )}
                <RunStatusBadge status={detail.data.run.status} />
              </div>
            </div>

            {detail.data.run.error && (
              <p role="status" className="rounded-md border bg-muted px-3 py-2 text-sm">{detail.data.run.error}</p>
            )}
            {detail.data.run.recovered && (
              <p role="status" className="text-sm text-muted-foreground">
                Saved changes were kept. Any unfinished evidence remains eligible for automatic review. No action is needed.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Label>Knowledge changes</Label>
              {!detail.data.changes.length && <p className="text-sm text-muted-foreground">No knowledge changes.</p>}
              {detail.data.changes.map(change => (
                <details key={change.id} className="rounded-md border">
                  <summary className="cursor-pointer break-all px-3 py-2 text-sm">
                    {change.path} ({change.status}{change.undoPending ? ', undo pending' : ''})
                  </summary>
                  <div className="flex flex-col gap-2 border-t px-3 py-2">
                    <ChangeDiff change={change} />
                    <Button variant="outline" size="sm" className="w-fit"
                      disabled={mutation.isPending || detail.data!.run.resolved || detail.data!.run.status === 'running' || change.status !== 'applied' || change.undoPending}
                      onClick={() => mutation.mutate(change.id)}>
                      Undo this change
                    </Button>
                  </div>
                </details>
              ))}
            </div>

            {serverId && sourceSessions.length > 0 && (
              <DisclosureRow label="Source conversations" summary={sourcesSummary} defaultOpen={false}>
                <div className="flex flex-col">
                  {sourceSessions.map(source => (
                    <Link key={source.sessionId}
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-primary underline-offset-4 hover:bg-muted/50 hover:underline"
                      to="/server/$serverId/workspace/session/$sessionId" params={{ serverId, sessionId: source.sessionId }}>
                      <span className="truncate">{sessionTitle(source.title)}</span>
                      {source.count > 1 && <span className="shrink-0 text-xs text-muted-foreground">{source.count} messages</span>}
                    </Link>
                  ))}
                </div>
              </DisclosureRow>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Latest 100 learning runs. Interrupted runs recover automatically. Excluding a conversation does not remove saved lessons. Undo preserves later edits.
      </p>

      {runs.error && (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {runs.error.message}
        </p>
      )}
      {runs.isPending && <p role="status" className="text-sm text-muted-foreground">Loading runs...</p>}
      {runs.data?.blocked && (
        <p role="status" className="text-sm text-muted-foreground">Learning is running or recovering automatically. No action is needed.</p>
      )}
      {runs.data && runs.data.runs.length === 0 && <p className="text-sm text-muted-foreground">No learning runs yet.</p>}

      {runs.data && runs.data.runs.length > 0 && (
        <div className="flex flex-col gap-1" aria-label="Learning runs">
          {runs.data.runs.map(run => {
            const meta = [reviewerLabel(run.reviewerId), run.recovered ? 'recovered automatically' : null, run.resolved ? 'resolved' : null]
              .filter(Boolean).join(' · ');
            return (
              <Button key={run.id} variant="ghost"
                className="h-auto w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left"
                onClick={() => { setRunId(run.id); mutation.reset(); }}>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="text-sm">{new Date(run.startedAt).toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">{meta}</span>
                </span>
                <RunStatusBadge status={run.status} />
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
