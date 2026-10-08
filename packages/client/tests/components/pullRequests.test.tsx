import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient, PullRequestDetail } from '@prokopai/sdk';
import { PullRequestDetailView } from '@/components/pullRequests/PullRequestDetailView';
import { PullRequestCreateForm } from '@/components/pullRequests/PullRequestCreateForm';
import {
  displayPath,
  draftKey,
  prKey,
  statusTone,
  usePrDrafts,
  type PullRequestContext,
} from '@/components/pullRequests/shared';

const head = 'a'.repeat(40);
const pr: PullRequestDetail = {
  number: 7,
  title: 'Fix login',
  body: 'Details',
  url: 'https://github.com/acme/app/pull/7',
  author: { id: 'author', name: 'Alice' },
  state: 'open',
  draft: false,
  sourceBranch: 'feature',
  targetBranch: 'main',
  head,
  base: 'b'.repeat(40),
  updatedAt: '2026-10-08',
  accountId: 'reviewer',
  reviewers: [],
  checks: [],
  comments: [],
  threads: [],
  warnings: [],
  mergeMethods: ['squash'],
  mergeability: 'mergeable',
};
const action = vi.fn();
const detail = vi.fn();
const createPr = vi.fn();
const client = { http: { pullRequests: { detail, action, create: createPr } } } as unknown as ProkopaiClient;
const ctx: PullRequestContext = {
  client,
  serverId: 'server',
  workspaceId: 'ws',
  scope: { root: '/worktree', remote: 'origin', repositoryKey: 'github:acme/app' },
  accountId: 'reviewer',
  provider: 'github',
};
beforeEach(() => {
  action.mockReset().mockResolvedValue({ ok: true });
  detail.mockReset().mockResolvedValue(pr);
  createPr.mockReset().mockResolvedValue(pr);
  usePrDrafts.setState({ values: {} });
});
afterEach(cleanup);
function show(
  context = ctx,
  cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }),
) {
  const result = render(
    <QueryClientProvider client={cache}>
      <PullRequestDetailView ctx={context} number={7} visible />
    </QueryClientProvider>,
  );
  return { ...result, cache };
}
test('posts feedback with exact repository, account and reviewed head, then clears only the successful draft', async () => {
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'Please test this edge case.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith('ws', ctx.scope, 7, {
      action: 'comment',
      body: 'Please test this edge case.',
      expectedHead: head,
      accountId: 'reviewer',
    }),
  );
  await waitFor(() => expect(field).toHaveValue(''));
});
test('failed writes retain feedback and do not retry automatically', async () => {
  action.mockRejectedValue(new Error('The provider refused this operation.'));
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'Keep my feedback' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  expect(await screen.findByText('The provider refused this operation.')).toBeInTheDocument();
  expect(field).toHaveValue('Keep my feedback');
  expect(action).toHaveBeenCalledTimes(1);
});
test('successful submission preserves a newer draft written while the request was pending', async () => {
  let finish!: (value: { ok: true }) => void;
  action.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show();
  const field = await screen.findByRole('textbox', { name: 'Review feedback' });
  fireEvent.change(field, { target: { value: 'First comment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  fireEvent.change(field, { target: { value: 'My next comment' } });
  finish({ ok: true });
  await screen.findByRole('button', { name: 'Post comment' });
  expect(field).toHaveValue('My next comment');
});
test('a changed head dismisses an open merge confirmation before it can apply to new changes', async () => {
  const { cache } = show();
  fireEvent.click(await screen.findByRole('button', { name: 'Merge PR' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  cache.setQueryData([...prKey(ctx), 'detail', 7], { ...pr, head: 'c'.repeat(40) });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(action).not.toHaveBeenCalled();
});
test('drafts survive navigation and are isolated by repository and account', async () => {
  const first = show();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Saved feedback' },
  });
  first.unmount();
  const second = show();
  expect(await screen.findByRole('textbox', { name: 'Review feedback' })).toHaveValue('Saved feedback');
  second.unmount();
  detail.mockResolvedValue({ ...pr, accountId: 'other' });
  show({ ...ctx, accountId: 'other' });
  expect(await screen.findByRole('textbox', { name: 'Review feedback' })).toHaveValue('');
  expect(usePrDrafts.getState().values[draftKey(ctx, 7, 'review')]).toBe('Saved feedback');
});
test('a pending action remains disabled after the detail panel remounts', async () => {
  let finish!: (value: { ok: true }) => void;
  action.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = show();
  fireEvent.change(await screen.findByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Only once' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  first.unmount();
  show(ctx, first.cache);
  expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeDisabled();
  finish({ ok: true });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Review feedback' })).toHaveValue(''));
  fireEvent.change(screen.getByRole('textbox', { name: 'Review feedback' }), {
    target: { value: 'Next comment' },
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Post comment' })).toBeEnabled());
});
test('refuses to act through a detail response from a different CLI account', async () => {
  detail.mockResolvedValue({ ...pr, accountId: 'someone-else' });
  show();
  expect(
    await screen.findByText('The CLI account changed. Rescan connections before continuing.'),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Merge PR' })).not.toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});
test('creation uses a published source and explicit target without calling Git push', async () => {
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PullRequestCreateForm ctx={ctx} branch="feature" onCreated={onCreated} onCancel={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Target branch'), { target: { value: 'main' } });
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New feature' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create PR' }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(7));
  expect(createPr).toHaveBeenCalledWith('ws', ctx.scope, {
    title: 'New feature',
    body: '',
    sourceBranch: 'feature',
    targetBranch: 'main',
    draft: true,
    accountId: 'reviewer',
  });
});
test('query keys separate servers, checkouts and signed-in accounts', () => {
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, serverId: 'another-server' }));
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, accountId: 'another-user' }));
  expect(prKey(ctx)).not.toEqual(prKey({ ...ctx, scope: { ...ctx.scope, root: '/another-checkout' } }));
});
test.each([
  ['succeeded', 'success'],
  ['Approved with suggestions', 'success'],
  ['APPROVED', 'success'],
  ['CHANGES_REQUESTED', 'failure'],
  ['Rejected', 'failure'],
  ['queued', 'pending'],
  ['Waiting for author', 'pending'],
  ['No vote', 'neutral'],
  ['notApplicable', 'neutral'],
])('provider state %s renders as %s', (state, tone) => {
  expect(statusTone(state)).toBe(tone);
});
test('Azure system paths display without their leading slash', () => {
  expect(displayPath('/src/app.ts')).toBe('src/app.ts');
  expect(displayPath('src/app.ts')).toBe('src/app.ts');
});
