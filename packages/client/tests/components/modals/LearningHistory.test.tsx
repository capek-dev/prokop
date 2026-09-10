import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn(), undo: vi.fn(), keep: vi.fn() }));
vi.mock('@/contexts/ServerClientContext', () => ({ useServerClient: () => ({ serverUrl: 'test-server', sdkClient: { http: { workspaces: {
  learningRuns: mocks.list, learningRun: mocks.detail, undoLearningChange: mocks.undo, keepLearningFiles: mocks.keep,
} } } }) }));
vi.mock('@tanstack/react-router', () => ({ useParams: () => ({}), Link: () => null }));
import { LearningHistory } from '@/components/modals/configuration/LearningHistory';

beforeEach(() => {
  vi.clearAllMocks();
  const run = { id: 'run', reviewerId: 'reviewer', status: 'failed', startedAt: 1000, error: 'Interrupted', resolved: false, recovered: true };
  mocks.list.mockResolvedValue({ runs: [run], blocked: true });
  mocks.detail.mockResolvedValue({ run, revision: 'revision', sources: [], changes: [{ id: 'change', path: 'memory/MEMORY.md', before: 'Before', after: 'After', status: 'applied', undoPending: false }] });
  mocks.undo.mockResolvedValue({ result: 'conflict' });
  mocks.keep.mockResolvedValue({ success: true });
});
function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><LearningHistory workspaceId="ws" /></QueryClientProvider>);
}

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
