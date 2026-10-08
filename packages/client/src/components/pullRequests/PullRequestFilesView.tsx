import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import type { PullRequestDetail, PullRequestFile, PullRequestPosition } from '@prokopai/sdk';
import { useTheme } from '@/components/providers/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Thread, ReviewForm, type ActOnPullRequest } from './PullRequestDetailView';
import { prKey, draftKey, usePrDraft, PrError, PrSelect, type PullRequestContext } from './shared';

export default function PullRequestFilesView({
  ctx,
  pr,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const files = useInfiniteQuery({
    queryKey: [...prKey(ctx), 'files', pr.number, pr.head],
    queryFn: ({ pageParam }) =>
      ctx.client.http.pullRequests.files(ctx.workspaceId, ctx.scope, pr.number, pr.head, pageParam),
    initialPageParam: 1,
    getNextPageParam: (p) => p.nextPage ?? undefined,
    retry: false,
    staleTime: 60_000,
  });
  const entries =
    files.data?.pages
      .flatMap((p) => p.files)
      .filter((f, i, all) => all.findIndex((x) => x.path === f.path) === i) ?? [];
  const current = entries.find((f) => f.path === selected) ?? entries[0];
  return (
    <div className="flex flex-col gap-3">
      <PrError error={files.error} />
      {files.data?.pages.some((page) => page.truncated) && (
        <p role="status" className="text-sm text-muted-foreground">
          The provider's changed-file limit was reached. Open on the provider for the full change.
        </p>
      )}
      {files.isPending && <Skeleton className="h-20" />}
      <Input
        aria-label="Filter changed files"
        placeholder="Filter loaded files"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <PrSelect
        label={`Changed files (${entries.length}${files.hasNextPage ? '+' : ''})`}
        value={current?.path ?? ''}
        onChange={setSelected}
        options={entries
          .filter((f) => f.path.toLowerCase().includes(search.toLowerCase()))
          .map((f) => ({
            value: f.path,
            label: `${f.path} · ${f.status}${f.additions !== null ? ` · +${f.additions} −${f.deletions}` : ''}`,
          }))}
      />
      {files.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          disabled={files.isFetchingNextPage}
          onClick={() => void files.fetchNextPage()}
        >
          Load more files
        </Button>
      )}
      {current && (
        <FileReview
          key={`${pr.head}:${current.path}`}
          ctx={ctx}
          pr={pr}
          file={current}
          iteration={files.data?.pages[0].iteration}
          act={act}
          busy={busy}
        />
      )}
      <ReviewForm ctx={ctx} pr={pr} act={act} busy={busy} />
    </div>
  );
}

function FileReview({
  ctx,
  pr,
  file,
  iteration,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  file: PullRequestFile;
  iteration?: number;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const { resolvedMode } = useTheme();
  const [style, setStyle] = useState<'unified' | 'split'>('unified');
  const [position, setPosition] = useState<PullRequestPosition | null>(null);
  const [body, setBody, clearBody] = usePrDraft(draftKey(ctx, pr.number, `inline:${file.path}`));
  const [viewed, setViewed] = usePrDraft(draftKey(ctx, pr.number, `viewed:${pr.head}:${file.path}`));
  const patch = useQuery({
    queryKey: [...prKey(ctx), 'patch', pr.number, pr.head, file.path],
    queryFn: () =>
      ctx.client.http.pullRequests.patch(ctx.workspaceId, ctx.scope, pr.number, pr.head, file.path),
    retry: false,
    staleTime: Infinity,
  });
  const parsed = useMemo(() => {
    try {
      return {
        files: patch.data?.patch ? parsePatchFiles(patch.data.patch, undefined, true).flatMap((p) => p.files) : [],
        error: null,
      };
    } catch {
      return { files: [], error: 'This patch could not be rendered. Open the file on the provider website.' };
    }
  }, [patch.data?.patch]);
  const threads = pr.threads.filter((t) => t.path === file.path || t.path === file.oldPath);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <PrSelect
          label="Diff layout"
          value={style}
          onChange={(v) => setStyle(v as 'unified' | 'split')}
          options={[
            { value: 'unified', label: 'Unified' },
            { value: 'split', label: 'Side by side' },
          ]}
        />
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={viewed === 'yes'}
            onChange={(e) => setViewed(e.target.checked ? 'yes' : '')}
          />
          Viewed in Prokop
        </label>
      </div>
      <PrError error={patch.error || parsed.error} />
      {patch.isPending && <Skeleton className="h-48" />}
      {patch.data?.unavailable && <p className="text-sm text-muted-foreground">{patch.data.unavailable}</p>}
      {parsed.files.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Click a line number to comment on that line. Provider patches may omit large sections.
        </p>
      )}
      <div className="min-w-0 overflow-x-auto rounded-md border">
        {parsed.files.map((diff, index) => (
          <FileDiff
            key={index}
            fileDiff={diff}
            options={{
              themeType: resolvedMode,
              diffStyle: style,
              onLineNumberClick: (line) =>
                setPosition({
                  path: file.path,
                  line: line.lineNumber,
                  side: line.annotationSide === 'deletions' ? 'LEFT' : 'RIGHT',
                  ...(iteration ? { iteration } : {}),
                  ...(file.changeTrackingId ? { changeTrackingId: file.changeTrackingId } : {}),
                }),
            }}
          />
        ))}
      </div>
      {position && (
        <form
          className="flex flex-col gap-2 rounded-md border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ action: 'comment', body, position })
              .then(() => {
                clearBody();
                setPosition(null);
              })
              .catch(() => {});
          }}
        >
          <p className="break-all text-sm">
            Comment on {position.side === 'LEFT' ? 'old' : 'new'} line {position.line} in {position.path}
          </p>
          <Textarea
            aria-label="Inline comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={60000}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !body.trim()}>
              Post inline comment
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPosition(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {threads.map((thread) => (
        <Thread key={thread.id} ctx={ctx} pr={pr} thread={thread} act={act} busy={busy} />
      ))}
    </div>
  );
}
