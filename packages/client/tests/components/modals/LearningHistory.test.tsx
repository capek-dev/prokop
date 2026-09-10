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
import { LearningHistory } from '@/components/modals/configuration/LearningHistory';

beforeEach(() => {
  vi.clearAllMocks();
  const run = { id: 'run', reviewerId: 'reviewer', status: 'failed', startedAt: 1000, error: 'Interrupted', resolved: false, recovered: true };
  mocks.list.mockResolvedValue({ runs: [run], blocked: true });
  mocks.detail.mockResolvedValue({ run, revision: 'revision', sources: [
    { sessionId: 'source-uuid', messageId: 'message', title: 'Fix retry handling' },
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

test('shows conversation titles with readable fallbacks and keeps session link destinations', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByRole('link', { name: 'Fix retry handling' })).toHaveAttribute('href', '/server/server/workspace/session/source-uuid');
  expect(screen.getAllByRole('link', { name: 'Untitled conversation' })).toHaveLength(2);
  expect(screen.queryByText('source-uuid')).toBeNull();
});

test('shows the reviewer name instead of its identity', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByText('Reviewer: Code reviewer')).toBeInTheDocument();
  expect(screen.queryByText('Reviewer: reviewer')).toBeNull();
});

test('uses a readable fallback when the reviewer is unavailable', async () => {
  const user = userEvent.setup(); mount(false);
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  expect(await screen.findByText('Reviewer: Unavailable reviewer')).toBeInTheDocument();
  expect(screen.queryByText('Reviewer: reviewer')).toBeNull();
});

test('shows exact changes and stale undo failure without reporting success', async () => {
  const user = userEvent.setup(); mount();
  await user.click(await screen.findByRole('button', { name: /failed/i }));
  await user.click(await screen.findByText('memory/MEMORY.md (applied)'));
  expect(screen.getByText('Before', { selector: 'pre' })).toBeInTheDocument();
  expect(screen.getByText('After', { selector: 'pre' })).toBeInTheDocument();
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
