import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { LearningRunSummary } from '@prokopai/sdk';
import { useServerClient } from '@/contexts/ServerClientContext';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

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

  const error = runs.error ?? detail.error ?? mutation.error;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Latest 100 learning runs. Interrupted runs recover automatically. Excluding a conversation does not remove saved lessons. Undo preserves later edits.
      </p>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}
      {runs.isPending && <p role="status" className="text-sm text-muted-foreground">Loading reviews...</p>}
      {runs.data?.blocked && (
        <p role="status" className="text-sm text-muted-foreground">Learning is running or recovering automatically. No action is needed.</p>
      )}
      {runs.data && runs.data.runs.length === 0 && <p className="text-sm text-muted-foreground">No reviews yet.</p>}

      {runs.data && runs.data.runs.length > 0 && (
        <div className="flex flex-col gap-1" aria-label="Learning runs">
          {runs.data.runs.map(run => {
            const selected = run.id === runId;
            const meta = [reviewerLabel(run.reviewerId), run.recovered ? 'recovered automatically' : null, run.resolved ? 'resolved' : null]
              .filter(Boolean).join(' · ');
            return (
              <Button key={run.id} variant="ghost"
                className={cn('h-auto w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left', selected && 'border-primary/50 bg-accent')}
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

      {detail.data && (
        <>
          <Separator />
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <Label>Run details</Label>
                <p className="text-xs text-muted-foreground">Learner: {reviewerLabel(detail.data.run.reviewerId)}</p>
              </div>
              <div className="flex items-center gap-2">
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">Before</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{change.before ?? '(file absent)'}</pre>
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="text-xs font-medium text-muted-foreground">After</p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{change.after ?? '(file deleted)'}</pre>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" className="w-fit"
                      disabled={mutation.isPending || detail.data!.run.resolved || detail.data!.run.status === 'running' || change.status !== 'applied' || change.undoPending}
                      onClick={() => mutation.mutate(change.id)}>
                      Undo this change
                    </Button>
                  </div>
                </details>
              ))}
            </div>

            {serverId && detail.data.sources.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Source conversations</Label>
                {detail.data.sources.map(source => (
                  <Link key={source.messageId} className="w-fit text-sm text-primary underline-offset-4 hover:underline"
                    to="/server/$serverId/workspace/session/$sessionId" params={{ serverId, sessionId: source.sessionId }}>
                    {sessionTitle(source.title)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
