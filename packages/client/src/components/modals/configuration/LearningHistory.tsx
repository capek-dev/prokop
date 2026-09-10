import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useServerClient } from '@/contexts/ServerClientContext';
import { Button } from '@/components/ui/button';

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
  return <div className="flex min-w-0 flex-col gap-3">
    <p className="text-xs text-muted-foreground">Latest 100 reviews. Interrupted reviews recover automatically. Excluding a conversation does not remove saved lessons. Undo preserves later edits.</p>
    {(runs.error || detail.error || mutation.error) && <p role="alert">{(runs.error || detail.error || mutation.error)?.message}</p>}
    {runs.isPending && <p role="status">Loading reviews...</p>}
    {runs.data?.blocked && <p role="status">Learning is running or recovering automatically. No action is needed.</p>}
    {runs.data?.runs.length === 0 && <p>No reviews yet.</p>}
    {runs.data?.runs.map(run => <Button variant="ghost" size="sm" key={run.id} onClick={() => { setRunId(run.id); mutation.reset(); }}>
      {new Date(run.startedAt).toLocaleString()} · {run.status}{run.recovered ? ' · recovered automatically' : run.resolved ? ' · resolved' : ''}
    </Button>)}
    {detail.data && <>
      <p>Reviewer: {detail.data.run.reviewerId}</p>
      {detail.data.run.error && <p role="status">{detail.data.run.error}</p>}
      {detail.data.run.recovered && <p role="status">Saved changes were kept. Any unfinished evidence remains eligible for automatic review. No action is needed.</p>}
      {!detail.data.changes.length && <p>No knowledge changes.</p>}
      {detail.data.changes.map(change => <details key={change.id}>
        <summary className="cursor-pointer break-all">{change.path} ({change.status}{change.undoPending ? ', undo pending' : ''})</summary>
        <p className="text-xs">Before</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{change.before ?? '(file absent)'}</pre>
        <p className="text-xs">After</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{change.after ?? '(file deleted)'}</pre>
        <Button variant="outline" size="sm" disabled={mutation.isPending || detail.data!.run.resolved || detail.data!.run.status === 'running' || change.status !== 'applied' || change.undoPending} onClick={() => mutation.mutate(change.id)}>Undo this change</Button>
      </details>)}
      {serverId && detail.data.sources.map(source => <Link key={source.messageId} to="/server/$serverId/workspace/session/$sessionId" params={{ serverId, sessionId: source.sessionId }}>Source: {source.sessionId}</Link>)}
    </>}
  </div>;
}
