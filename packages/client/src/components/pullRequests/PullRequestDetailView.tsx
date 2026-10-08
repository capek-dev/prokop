import { lazy, Suspense, useState } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  PullRequestAction,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestThread,
  PullRequestVote,
} from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { draftKey, prKey, PrError, PrSelect, safePrUrl, usePrDraft, type PullRequestContext } from './shared';

const PullRequestFilesView = lazy(() => import('./PullRequestFilesView'));
export type ActOnPullRequest = (action: PullRequestAction) => Promise<void>;

export function PullRequestDetailView({
  ctx,
  number,
  visible,
}: {
  ctx: PullRequestContext;
  number: number;
  visible: boolean;
}) {
  const cache = useQueryClient();
  const detail = useQuery({
    queryKey: [...prKey(ctx), 'detail', number],
    queryFn: () => ctx.client.http.pullRequests.detail(ctx.workspaceId, ctx.scope, number),
    enabled: visible,
    retry: false,
    staleTime: 30_000,
  });
  const mutationKey = [...prKey(ctx), 'action', number];
  const records = useMutationState({
    filters: { mutationKey, exact: true },
    select: (m) => ({ status: m.state.status, error: m.state.error }),
  });
  const pending = records.some((r) => r.status === 'pending');
  const mutation = useMutation({
    mutationKey,
    mutationFn: (action: PullRequestAction) => {
      if (!detail.data) throw new Error('Load the PR first.');
      return ctx.client.http.pullRequests.action(ctx.workspaceId, ctx.scope, number, {
        ...action,
        expectedHead: detail.data.head,
        accountId: detail.data.accountId,
      });
    },
    retry: false,
    onSettled: () => {
      void cache.invalidateQueries({ queryKey: prKey(ctx) });
    },
  });
  const [tab, setTab] = useState('overview');
  const act: ActOnPullRequest = async (action) => {
    if (pending) throw new Error('An operation is already in progress.');
    await mutation.mutateAsync(action);
  };
  if (detail.isPending) return <Skeleton className="m-4 h-32" />;
  if (!detail.data || detail.error)
    return (
      <div className="p-4">
        <PrError error={detail.error} />
        <Button onClick={() => void detail.refetch()}>Retry</Button>
      </div>
    );
  const pr = detail.data;
  if (pr.accountId !== ctx.accountId)
    return <PrError error="The CLI account changed. Rescan connections before continuing." />;
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{pr.draft ? 'Draft' : pr.state}</Badge>
          <span className="text-xs text-muted-foreground">
            #{number} · {pr.author.name}
          </span>
          <a
            className="ml-auto text-xs underline"
            href={safePrUrl(pr.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on {ctx.provider === 'github' ? 'GitHub' : 'Azure'}
          </a>
        </div>
        <h2 className="text-lg font-medium">{pr.title}</h2>
        <p className="break-all text-xs text-muted-foreground">
          {pr.sourceBranch} → {pr.targetBranch}
        </p>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <PrError error={records.at(-1)?.error} />
        {records.at(-1)?.status === 'success' && (
          <p role="status" className="mb-2 text-xs text-muted-foreground">
            Action accepted. Remote merges and checks may still be processing.
          </p>
        )}
        {pr.warnings.map((w) => (
          <p key={w} role="status" className="mb-2 text-sm text-muted-foreground">
            {w}
          </p>
        ))}
        <TabsContent value="overview">
          <Overview key={`${pr.head}:${pr.targetBranch}`} ctx={ctx} pr={pr} act={act} busy={pending} />
        </TabsContent>
        <TabsContent value="activity" className="flex flex-col gap-4">
          {pr.comments.map((c) => (
            <article key={`${c.id}:${c.createdAt}`} className="rounded-md border p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                {c.author.name} · {new Date(c.createdAt).toLocaleString()}
              </p>
              <Markdown body={c.body} />
            </article>
          ))}
          {pr.threads.map((t) => (
            <Thread key={t.id} ctx={ctx} pr={pr} thread={t} act={act} busy={pending} />
          ))}
          {!pr.comments.length && !pr.threads.length && (
            <p className="text-sm text-muted-foreground">No conversation yet.</p>
          )}
          <ReviewForm ctx={ctx} pr={pr} act={act} busy={pending} />
        </TabsContent>
        <TabsContent value="files">
          {tab === 'files' && (
            <Suspense fallback={<Skeleton className="h-32" />}>
              <PullRequestFilesView ctx={ctx} pr={pr} act={act} busy={pending} />
            </Suspense>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

export function Markdown({ body }: { body: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>{alt || 'Image'} (open on provider)</span>,
          a: ({ href, children }) => (
            <a
              href={href ? safePrUrl(href) : undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function Overview({
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
  const [editing, setEditing] = useState(false);
  const [reviewer, setReviewer] = useState('');
  const [method, setMethod] = useState<PullRequestMergeMethod>(pr.mergeMethods[0] ?? 'squash');
  const [confirm, setConfirm] = useState<'merge' | 'close' | 'auto' | null>(null);
  const perform = (action: PullRequestAction) => {
    void act(action).catch(() => {});
  };
  return (
    <div className="flex flex-col gap-5">
      {editing ? (
        <EditForm ctx={ctx} pr={pr} act={act} busy={busy} close={() => setEditing(false)} />
      ) : (
        <div className="flex flex-col gap-2">
          <Markdown body={pr.body || 'No description.'} />
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setEditing(true)}
            disabled={busy || pr.state === 'merged'}
          >
            Edit title and description
          </Button>
        </div>
      )}
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Reviewers</h3>
        {pr.reviewers.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">
              {r.name} · {r.vote}
            </span>
            {pr.state === 'open' && (ctx.provider === 'azure' || pr.requestedReviewerIds?.includes(r.id)) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  perform({
                    action: 'reviewer',
                    reviewer: ctx.provider === 'github' ? r.name : r.id,
                    remove: true,
                  })
                }
              >
                {ctx.provider === 'github' ? 'Cancel request' : 'Remove'}
              </Button>
            )}
          </div>
        ))}
        {pr.state === 'open' && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: 'reviewer', reviewer, remove: false })
                .then(() => setReviewer(''))
                .catch(() => {});
            }}
          >
            <Input
              aria-label="Reviewer"
              placeholder={ctx.provider === 'github' ? 'GitHub username' : 'Reviewer email or identity ID'}
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={busy || !reviewer.trim()}>
              Request review
            </Button>
          </form>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Checks and policies</h3>
        {pr.checks.length ? (
          pr.checks.map((c, i) => (
            <div key={`${c.name}:${i}`} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {c.url ? (
                  <a href={safePrUrl(c.url)} target="_blank" rel="noopener noreferrer" className="underline">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </span>
              <Badge variant="secondary">{c.state}</Badge>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No check results reported.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Merge status: {pr.mergeability}. The provider enforces repository policies.
        </p>
      </section>
      {pr.state !== 'merged' && (
        <div className="flex flex-wrap items-end gap-2">
          {pr.state === 'open' ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => perform({ action: pr.draft ? 'ready' : 'draft' })}
              >
                {pr.draft ? 'Ready for review' : 'Convert to draft'}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirm('close')}>
                {ctx.provider === 'azure' ? 'Abandon' : 'Close'} PR
              </Button>
              {!pr.draft && pr.mergeMethods.length > 0 && (
                <>
                  <PrSelect
                    label="Merge method"
                    value={method}
                    onChange={(v) => setMethod(v as PullRequestMergeMethod)}
                    options={pr.mergeMethods.map((value) => ({
                      value,
                      label:
                        value === 'rebase-merge'
                          ? 'Rebase with merge commit'
                          : value[0].toUpperCase() + value.slice(1),
                    }))}
                  />
                  <Button
                    disabled={busy || pr.mergeability === 'conflicting' || !pr.mergeMethods.includes(method)}
                    onClick={() => setConfirm('merge')}
                  >
                    {ctx.provider === 'azure' ? 'Complete' : 'Merge'} PR
                  </Button>
                </>
              )}
            </>
          ) : (
            <Button disabled={busy} onClick={() => perform({ action: 'reopen' })}>
              Reopen PR
            </Button>
          )}
        </div>
      )}
      {pr.state === 'open' && !pr.draft && (
        <div className="flex flex-col items-start gap-1">
          <Button
            variant="outline"
            disabled={busy || (!pr.autoMerge && !pr.mergeMethods.includes(method))}
            onClick={() => (pr.autoMerge ? perform({ action: 'disable-auto-merge' }) : setConfirm('auto'))}
          >
            {pr.autoMerge ? 'Disable automatic merge' : 'Merge when checks pass'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Automatic merging follows repository policies and may happen immediately if already eligible.
          </p>
        </div>
      )}
      <ReviewForm ctx={ctx} pr={pr} act={act} busy={busy} />
      <ConfirmationDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        title={
          confirm === 'auto'
            ? `Enable automatic merge for #${pr.number}?`
            : confirm === 'merge'
              ? `Merge #${pr.number}?`
              : `Close #${pr.number}?`
        }
        description={
          confirm === 'auto'
            ? `The provider will merge ${pr.sourceBranch} into ${pr.targetBranch} using ${method} when eligible, possibly immediately.`
            : confirm === 'merge'
              ? `${pr.sourceBranch} → ${pr.targetBranch}, using ${method}. This changes the remote repository.`
              : 'This closes the remote pull request without merging it.'
        }
        confirmLabel={
          confirm === 'auto' ? 'Enable automatic merge' : confirm === 'merge' ? 'Merge PR' : 'Close PR'
        }
        loading={busy}
        onConfirm={() => {
          void act(
            confirm === 'auto'
              ? { action: 'enable-auto-merge', method }
              : confirm === 'merge'
                ? { action: 'merge', method }
                : { action: 'close' },
          )
            .then(() => setConfirm(null))
            .catch(() => {});
        }}
      />
    </div>
  );
}

function EditForm({
  ctx,
  pr,
  act,
  busy,
  close,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  act: ActOnPullRequest;
  busy: boolean;
  close(): void;
}) {
  const [saved, setSaved, clearSaved] = usePrDraft(draftKey(ctx, pr.number, 'edit'));
  const [draft, setDraft] = useState(() => {
    try {
      const value: unknown = JSON.parse(saved);
      if (
        value &&
        typeof value === 'object' &&
        'title' in value &&
        typeof value.title === 'string' &&
        'body' in value &&
        typeof value.body === 'string'
      )
        return { title: value.title, body: value.body };
    } catch {
      /* First edit. */
    }
    return { title: pr.title, body: pr.body };
  });
  const update = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaved(JSON.stringify(next));
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: 'edit', ...draft })
          .then(() => {
            clearSaved();
            close();
          })
          .catch(() => {});
      }}
    >
      <Label htmlFor="pr-edit-title">Title</Label>
      <Input
        id="pr-edit-title"
        value={draft.title}
        onChange={(e) => update({ title: e.target.value })}
        maxLength={300}
        required
      />
      <Label htmlFor="pr-edit-body">Description</Label>
      <Textarea
        id="pr-edit-body"
        value={draft.body}
        onChange={(e) => update({ body: e.target.value })}
        rows={8}
        maxLength={60000}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !draft.title.trim()}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ReviewForm({
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
  const [body, setBody, clearBody] = usePrDraft(draftKey(ctx, pr.number, 'review'));
  const [selectedVerdict, setVerdict] = useState<PullRequestVote>('comment');
  const canReview = pr.state === 'open' && (ctx.provider === 'azure' || pr.author.id !== ctx.accountId);
  const verdict = canReview ? selectedVerdict : 'comment';
  const options = [
    { value: 'comment', label: 'Comment' },
    ...(canReview
      ? [
          { value: 'approve', label: 'Approve' },
          { value: 'request-changes', label: ctx.provider === 'azure' ? 'Reject' : 'Request changes' },
          ...(ctx.provider === 'azure'
            ? [
                { value: 'approve-with-suggestions', label: 'Approve with suggestions' },
                { value: 'wait', label: 'Wait for author' },
                { value: 'reset', label: 'Reset vote' },
              ]
            : []),
        ]
      : []),
  ];
  return (
    <form
      className="flex flex-col gap-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act(verdict === 'comment' ? { action: 'comment', body } : { action: 'review', verdict, body })
          .then(() => {
            clearBody();
            setVerdict('comment');
          })
          .catch(() => {});
      }}
    >
      <PrSelect
        label="Review"
        value={verdict}
        onChange={(v) => setVerdict(v as PullRequestVote)}
        options={options}
      />
      <Textarea
        aria-label="Review feedback"
        placeholder="Write a comment…"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        maxLength={60000}
      />
      <Button
        type="submit"
        className="self-start"
        disabled={busy || (['comment', 'request-changes'].includes(verdict) && !body.trim())}
      >
        {busy ? 'Submitting…' : verdict === 'comment' ? 'Post comment' : 'Submit review'}
      </Button>
    </form>
  );
}

export function Thread({
  ctx,
  pr,
  thread,
  act,
  busy,
}: {
  ctx: PullRequestContext;
  pr: PullRequestDetail;
  thread: PullRequestThread;
  act: ActOnPullRequest;
  busy: boolean;
}) {
  const [reply, setReply, clearReply] = usePrDraft(draftKey(ctx, pr.number, `reply:${thread.id}`));
  return (
    <article className="flex flex-col gap-3 rounded-md border bg-background p-3 text-foreground">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 break-all">
          {thread.path}
          {thread.line ? `:${thread.line}` : ''}
        </span>
        {thread.outdated && <Badge variant="secondary">Outdated</Badge>}
        <Badge variant="secondary">{thread.resolved ? 'Resolved' : 'Open'}</Badge>
      </div>
      {thread.comments.map((c) => (
        <div key={c.id}>
          <p className="mb-1 text-xs text-muted-foreground">{c.author.name}</p>
          <Markdown body={c.body} />
        </div>
      ))}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act({ action: 'reply', threadId: thread.id, body: reply })
            .then(clearReply)
            .catch(() => {});
        }}
      >
        <Textarea
          aria-label="Reply to conversation"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          maxLength={60000}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || !reply.trim()}>
            Reply
          </Button>
          {thread.canResolve && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                void act({ action: 'resolve', threadId: thread.id, resolved: !thread.resolved }).catch(
                  () => {},
                );
              }}
            >
              {thread.resolved ? 'Reopen conversation' : 'Resolve'}
            </Button>
          )}
        </div>
      </form>
    </article>
  );
}
