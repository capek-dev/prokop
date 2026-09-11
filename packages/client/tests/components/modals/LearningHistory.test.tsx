import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), undo: vi.fn(), keep: vi.fn(), store: vi.fn() }));
vi.mock('@/contexts/ServerClientContext', () => ({ useServerClient: () => ({ serverUrl: 'test-server', sdkClient: { http: { workspaces: {
  learningRuns: mocks.list, learningRun: mocks.detail, undoLearningChange: mocks.undo, keepLearningFiles: mocks.keep,
} } } }) }));
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ serverId: 'server' }),
  Link: ({ children, params }: { children: ReactNode; params: { serverId: string; sessionId: string } }) =>
    <a href={`/server/${params.serverId}/workspace/session/${params.sessionId}`}>{children}</a>,
}));
vi.mock('@/stores/serverDataStore', () => ({ useServerDataStore: (selector: (state: unknown) => unknown) => selector(mocks.store()) }));
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ openFilePreview: vi.fn() }),
}));
// Pierre renders into shadow DOM, invisible to light-DOM queries; the mock surfaces the serialized patch.
vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: ({ patch }: { patch: string }) => <div data-testid="patch-diff">{patch}</div>,
}));
import { LearningHistory } from '@/components/modals/configuration/LearningHistory';

beforeEach(() => {
  vi.clearAllMocks();
  const run = { id: 'run', reviewerId: 'reviewer', status: 'failed', startedAt: 1000, error: 'Interrupted', resolved: false, recovered: true };
  mocks.list.mockResolvedValue({ runs: [run], blocked: true });
  mocks.detail.mockResolvedValue({ run, revision: 'revision', sources: [
    { sessionId: 'source-uuid', messageId: 'message', title: 'Fix retry handling' },
    { sessionId: 'source-uuid', messageId: 'message-2', title: 'Fix retry handling' },
    { sessionId: 'untitled-uuid', messageId: 'untitled', title: '  ' },
    { sessionId: 'legacy-uuid', messageId: 'legacy' },
  ], changes: [{ id: 'change', path: 'memory/MEMORY.md', before: 'Before', after: 'After', status: 'applied', undoPending: false }] });
  mocks.undo.mockResolvedValue({ result: 'conflict' });
  mocks.keep.mockResolvedValue({ success: true });
});
function mount(available = true) {
  mocks.store.mockReturnValue({
    workspaces: [{ id: 'ws', settings: { learning: { reviewers: available ? [{ id: 'reviewer', preconfigId: 'preconfig' }] : [] } } }],
    preconfigs: [{ id: 'preconfig', name: 'Code reviewer' }],
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><LearningHistory workspaceId="ws" /></QueryClientProvider>);
}

test('opens the review transcript when available', async () => {
  mocks.detail.mockResolvedValue({ run: { id: 'run', reviewerId: 'reviewer', status: 'completed' }, sessionId: 'review-session', sources: [], changes: [] });
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByRole('link', { name: 'Open learning session' })).toHaveAttribute('href', '/server/server/workspace/session/review-session');
});

test('a run opens as its own screen and back returns to the list', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByRole('button', { name: /back to runs/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /failed/i })).toBeNull();
  await user.click(screen.getByRole('button', { name: /back to runs/i }));
  expect(await screen.findByRole('button', { name: /failed/i })).toBeInTheDocument();
});

test('hides the transcript button for older responses without a session', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  await screen.findByRole('button', { name: /back to runs/i });
  expect(screen.queryByRole('link', { name: 'Open learning session' })).toBeNull();
});

test('groups source messages by conversation and stays collapsed until opened', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  const trigger = await screen.findByRole('button', { name: /^Source conversations/ });
  expect(trigger).toHaveTextContent('3 conversations · 4 messages');
  expect(screen.queryByRole('link', { name: /Fix retry handling/ })).toBeNull();
  await user.click(trigger);
  expect(screen.getByRole('link', { name: /Fix retry handling/ })).toHaveAttribute('href', '/server/server/workspace/session/source-uuid');
  expect(screen.getByRole('link', { name: /Fix retry handling/ })).toHaveTextContent('2 messages');
  expect(screen.getAllByRole('link', { name: 'Untitled conversation' })).toHaveLength(2);
  expect(screen.queryByText('source-uuid')).toBeNull();
});

test('shows the learner name instead of its identity', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByText('Learner: Code reviewer')).toBeInTheDocument();
  expect(screen.queryByText('Learner: reviewer')).toBeNull();
});

test('uses a readable fallback when the learner is unavailable', async () => {
  const user = userEvent.setup(); mount(false);
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByText('Learner: Unavailable learner')).toBeInTheDocument();
  expect(screen.queryByText('Learner: reviewer')).toBeNull();
});

test('shows exact changes and stale undo failure without reporting success', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  await user.click(await screen.findByText('memory/MEMORY.md (applied)'));
  const patch = screen.getByTestId('patch-diff');
  expect(patch.textContent).toContain('-Before');
  expect(patch.textContent).toContain('+After');
  await user.click(screen.getByRole('button', { name: 'Undo this change' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Undo did not overwrite it');
  expect(mocks.undo).toHaveBeenCalledWith('ws', 'run', 'change');
});

test('automatic recovery needs no acknowledgement and keeps undo available', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /recovered automatically/ }));
  expect(await screen.findByText(/Saved changes were kept/)).toHaveTextContent('No action is needed.');
  expect(screen.queryByRole('button', { name: /resolve|keep current/i })).toBeNull();
  await user.click(screen.getByText('memory/MEMORY.md (applied)'));
  expect(screen.getByRole('button', { name: 'Undo this change' })).toBeEnabled();
  expect(mocks.keep).not.toHaveBeenCalled();
});
