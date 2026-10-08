import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { parsePatchFiles } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs/react';
import { Check } from 'lucide-react';
import type { PullRequestDetail, PullRequestFile, PullRequestPosition } from '@prokopai/sdk';
import { useTheme } from '@/components/providers/ThemeProvider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Thread, ReviewForm, type ActOnPullRequest } from './PullRequestDetailView';
import {
  displayPath,
  draftKey,
  prKey,
  PrError,
  usePrDraft,
  usePrDrafts,
  type PullRequestContext,
} from './shared';

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
  const drafts = usePrDrafts((s) => s.values);
  const isViewed = (file: PullRequestFile) =>
    drafts[draftKey(ctx, pr.number, `viewed:${pr.head}:${file.path}`)] === 'yes';
  const viewedCount = entries.filter(isViewed).length;
  const visibleEntries = entries.filter((f) => f.path.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="flex flex-col gap-4">
      <PrError error={files.error} />
      {files.data?.pages.some((page) => page.truncated) && (
        <p role="status" className="text-sm text-warning">
          The provider's changed-file limit was reached. Open on the provider for the full change.
        </p>
      )}
      <div className="grid gap-4 @3xl:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Changed files" className="flex min-w-0 flex-col gap-2 @3xl:sticky @3xl:top-0 @3xl:self-start">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex-1">
              {entries.length}
              {files.hasNextPage ? '+' : ''} changed files
            </span>
            {entries.length > 0 && (
              <span>
                {viewedCount}/{entries.length} viewed
              </span>
            )}
          </div>
          {entries.length > 0 && (
            <Progress value={(viewedCount / entries.length) * 100} aria-label="Files viewed" className="h-1" />
          )}
          <Input
            aria-label="Filter changed files"
            placeholder="Filter files"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {files.isPending && <Skeleton className="h-40" />}
          <ul className="flex max-h-64 flex-col overflow-auto rounded-md border p-1 @3xl:max-h-[calc(100vh-16rem)]">
            {visibleEntries.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  aria-current={f.path === current?.path ? 'true' : undefined}
                  title={displayPath(f.path)}
                  onClick={() => setSelected(f.path)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted',
                    f.path === current?.path && 'bg-muted',
                    isViewed(f) && 'text-muted-foreground',
                  )}
                >
                  <FileStatus status={f.status} />
                  <span className="min-w-0 flex-1 truncate" dir="rtl">
                    {/* RTL truncation keeps the file name visible for deep paths. */}
                    <bdi>{displayPath(f.path)}</bdi>
                  </span>
                  {f.additions !== null && (
                    <span className="shrink-0 font-mono text-[10px]">
                      <span className="text-success">+{f.additions}</span>{' '}
                      <span className="text-destructive">−{f.deletions}</span>
                    </span>
                  )}
                  {isViewed(f) && <Check aria-label="Viewed" className="size-3 shrink-0 text-success" />}
                </button>
              </li>
            ))}
            {!files.isPending && !visibleEntries.length && (
              <li className="p-2 text-xs text-muted-foreground">No matching files.</li>
            )}
          </ul>
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
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
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
      </div>
    </div>
  );
}

const fileStatuses: [RegExp, string, string][] = [
  [/rename/i, 'R', 'text-primary'],
  [/add/i, 'A', 'text-success'],
  [/delete|remove/i, 'D', 'text-destructive'],
];
function FileStatus({ status }: { status: string }) {
  const [, letter, className] = fileStatuses.find(([pattern]) => pattern.test(status)) ?? [
    null,
    'M',
    'text-warning',
  ];
  return (
    <span title={status} className={cn('w-3 shrink-0 text-center font-mono text-[10px] font-semibold', className)}>
      {letter}
    </span>
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
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="min-w-0 flex-1 break-all font-mono text-sm">
          {file.oldPath && file.oldPath !== file.path && (
            <span className="text-muted-foreground">{displayPath(file.oldPath)} → </span>
          )}
          {displayPath(file.path)}
        </h3>
        <div role="group" aria-label="Diff layout" className="flex rounded-md border p-0.5">
          {(
            [
              ['unified', 'Unified'],
              ['split', 'Split'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="xs"
              variant={style === value ? 'secondary' : 'ghost'}
              aria-pressed={style === value}
              onClick={() => setStyle(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={viewed === 'yes'} onCheckedChange={(checked) => setViewed(checked === true ? 'yes' : '')} />
          Viewed
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
            Comment on {position.side === 'LEFT' ? 'old' : 'new'} line {position.line} in{' '}
            {displayPath(position.path)}
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
