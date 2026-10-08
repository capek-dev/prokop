import { useState } from 'react';
import { useMutation, useMutationState } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { draftKey, PrError, usePrDraft, type PullRequestContext } from './shared';

export function PullRequestCreateForm({
  ctx,
  branch,
  onCreated,
  onCancel,
}: {
  ctx: PullRequestContext;
  branch: string;
  onCreated(number: number): void;
  onCancel(): void;
}) {
  const [title, setTitle, clearTitle] = usePrDraft(draftKey(ctx, 'create', 'title'));
  const [body, setBody, clearBody] = usePrDraft(draftKey(ctx, 'create', 'body'));
  const [savedSource, saveSource, clearSource] = usePrDraft(draftKey(ctx, 'create', 'source'));
  const [source, setSource] = useState(savedSource || branch);
  const [target, setTarget] = usePrDraft(draftKey(ctx, 'create', 'target'));
  const [mode, setMode, clearMode] = usePrDraft(draftKey(ctx, 'create', 'mode'));
  const draft = mode !== 'ready';
  const pending =
    useMutationState({
      filters: { mutationKey: prKeyForCreate(ctx), exact: true, status: 'pending' },
      select: () => true,
    }).length > 0;
  const mutation = useMutation({
    mutationKey: [...prKeyForCreate(ctx)],
    mutationFn: () =>
      ctx.client.http.pullRequests.create(ctx.workspaceId, ctx.scope, {
        title,
        body,
        sourceBranch: source,
        targetBranch: target,
        draft,
        accountId: ctx.accountId,
      }),
    retry: false,
    onSuccess: (pr) => {
      clearTitle();
      clearBody();
      clearSource();
      clearMode();
      onCreated(pr.number);
    },
  });
  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!pending) mutation.mutate();
      }}
    >
      <h2 className="text-lg font-medium">Create pull request</h2>
      <p className="text-sm text-muted-foreground">
        Push your source branch first using Branches. Creating a PR does not push local changes.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pr-source">
          Source branch{ctx.provider === 'github' ? ' (owner:branch for a fork)' : ''}
        </Label>
        <Input
          id="pr-source"
          disabled={pending}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            saveSource(e.target.value);
          }}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pr-target">Target branch</Label>
        <Input
          id="pr-target"
          disabled={pending}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pr-title">Title</Label>
        <Input
          id="pr-title"
          disabled={pending}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={300}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="pr-body">Description</Label>
        <Textarea
          id="pr-body"
          disabled={pending}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          maxLength={60000}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          disabled={pending}
          checked={draft}
          onChange={(e) => setMode(e.target.checked ? '' : 'ready')}
        />
        Create as draft
      </label>
      <PrError error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !title.trim() || !source || !target}>
          {pending ? 'Creating…' : 'Create PR'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
const prKeyForCreate = (ctx: PullRequestContext) => [
  'pr-create',
  ctx.serverId,
  ctx.workspaceId,
  ctx.scope.repositoryKey,
];
