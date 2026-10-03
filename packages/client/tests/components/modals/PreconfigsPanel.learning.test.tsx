import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  settings: null as Record<string, unknown> | null,
  tools: { tools: [] },
  store: { models: [], workspaces: [] },
}));

vi.mock('@/hooks/queries', () => ({
  usePreconfigsQuery: () => ({ data: { preconfigs: [{ id: 'agent', name: 'Test agent', settings: mocks.settings }] } }),
  useToolsQuery: () => ({ data: mocks.tools }),
  useAgentsQuery: () => ({ data: { agents: [] } }),
  useCreatePreconfig: () => ({ mutateAsync: mocks.save }),
  useUpdatePreconfig: () => ({ mutateAsync: mocks.save }),
  useDeletePreconfig: () => ({ mutateAsync: vi.fn() }),
  useDemoteAgent: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));
vi.mock('@/components/modals/configuration/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('@/components/modals/configuration/LearningHistory', () => ({ LearningHistory: () => null }));

import { PreconfigsPanel } from '@/components/modals/configuration/PreconfigsPanel';

beforeEach(() => {
  mocks.settings = null;
  mocks.save.mockReset().mockResolvedValue({});
});

async function editAgent() {
  const user = userEvent.setup();
  render(<QueryClientProvider client={new QueryClient()}><PreconfigsPanel sdkClient={null} /></QueryClientProvider>);
  await user.click(screen.getByText('Test agent'));
  await user.click(screen.getByRole('button', { name: /^Advanced Capabilities/ }));
  return user;
}

test('shows agent defaults as labeled placeholders and saves unchanged timing as inherited', async () => {
  const user = await editAgent();
  for (const [label, value] of [['Quiet period', '60'], ['Min interval', '1440'], ['Max pending age', '1440']]) {
    expect(screen.getByLabelText(label)).toHaveAttribute('placeholder', value);
    expect(screen.getByLabelText(label)).toHaveValue(null);
  }
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    body: expect.objectContaining({ settings: expect.objectContaining({ learning: expect.objectContaining({ cadence: null }) }) }),
  })));
});

test('saves one smaller value while using defaults for the untouched fields', async () => {
  const user = await editAgent();
  await user.type(screen.getByLabelText('Quiet period'), '15');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    body: expect.objectContaining({ settings: expect.objectContaining({ learning: expect.objectContaining({
      cadence: { idleMinutes: 15, minimumIntervalMinutes: 1440, maximumPendingMinutes: 1440 },
    }) }) }),
  })));
});

test('shows saved overrides and restores inherited timing when all fields are cleared', async () => {
  mocks.settings = { learning: { enabled: true, cadence: { idleMinutes: 15, minimumIntervalMinutes: 120, maximumPendingMinutes: 720 }, instructions: '', sources: { mode: 'all' } } };
  const user = await editAgent();
  expect(screen.getByLabelText('Quiet period')).toHaveValue(15);
  expect(screen.getByLabelText('Min interval')).toHaveValue(120);
  expect(screen.getByLabelText('Max pending age')).toHaveValue(720);
  for (const label of ['Quiet period', 'Min interval', 'Max pending age']) {
    await user.clear(screen.getByLabelText(label));
  }
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({
    body: expect.objectContaining({ settings: expect.objectContaining({ learning: expect.objectContaining({ cadence: null }) }) }),
  })));
});

test.each([
  ['Quiet period', '0'],
  ['Quiet period', '10081'],
  ['Quiet period', '1.5'],
  ['Max pending age', '60'],
])('rejects invalid %s value %s including conflicts with inherited values', async (label, value) => {
  const user = await editAgent();
  await user.type(screen.getByLabelText(label), value);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(/Learning timing must be whole minutes/)).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});
