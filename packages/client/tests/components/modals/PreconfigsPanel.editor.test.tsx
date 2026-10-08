import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  agents: [] as Array<{ id: string }>,
  // Stable references: the panel copies tools in an effect keyed on this object.
  tools: { tools: [] },
  preconfigs: { preconfigs: [{
    id: 'agent', name: 'Test agent', description: '', systemPrompt: '', tools: null, settings: null,
    isDefault: false, capabilities: { memory: false, skills: true },
  }] },
  store: { models: [], workspaces: [] },
}));

vi.mock('@/hooks/queries', () => ({
  usePreconfigsQuery: () => ({ data: mocks.preconfigs }),
  useToolsQuery: () => ({ data: mocks.tools }),
  useAgentsQuery: () => ({ data: { agents: mocks.agents } }),
  useCreatePreconfig: () => ({ mutateAsync: mocks.create }),
  useUpdatePreconfig: () => ({ mutateAsync: mocks.update }),
  useDeletePreconfig: () => ({ mutateAsync: vi.fn() }),
  useDemoteAgent: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));
vi.mock('@/components/modals/configuration/AgentModelPicker', () => ({ AgentModelPicker: () => null }));
vi.mock('@/components/modals/configuration/LearningHistory', () => ({ LearningHistory: () => null }));

import { PreconfigsPanel, type AgentEditorDraft } from '@/components/modals/configuration/PreconfigsPanel';

beforeEach(() => {
  mocks.agents = [];
  mocks.create.mockReset().mockResolvedValue({});
  mocks.update.mockReset().mockResolvedValue({});
});

function renderPanel(sdkClient: ProkopaiClient | null = null) {
  return render(<QueryClientProvider client={new QueryClient()}><PreconfigsPanel sdkClient={sdkClient} /></QueryClientProvider>);
}

test('reports an empty tool selection as 0 tools instead of defaults', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByText('Test agent'));
  expect(screen.getByRole('button', { name: /^Prokop Runtime/ })).toHaveTextContent('0 tools');
  expect(screen.getByRole('button', { name: /^Prokop Runtime/ })).not.toHaveTextContent('Defaults');
});

test('duplicating an agent keeps its memory and skills capabilities', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByTitle('Duplicate agent'));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    name: 'Test agent Copy', capabilities: { memory: false, skills: true },
  })));
});

test('back leaves an unchanged editor at once and asks before discarding edits', async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByText('Test agent'));
  await user.click(screen.getByRole('button', { name: 'Back to agents' }));
  expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /New Agent/ })).toBeInTheDocument();

  await user.click(screen.getByText('Test agent'));
  await user.type(screen.getByPlaceholderText('Description...'), 'edited');
  await user.click(screen.getByRole('button', { name: 'Back to agents' }));
  expect(screen.getByText('Discard changes?')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  expect(screen.getByRole('button', { name: /New Agent/ })).toBeInTheDocument();
  expect(mocks.update).not.toHaveBeenCalled();
});

test('a lifted draft keeps unsaved edits when the panel remounts', async () => {
  const user = userEvent.setup();
  function Host() {
    const [draft, setDraft] = useState<AgentEditorDraft | null>(null);
    const [shown, setShown] = useState(true);
    return <>
      <button type="button" onClick={() => setShown(value => !value)}>toggle</button>
      {shown && <PreconfigsPanel sdkClient={null} draft={draft} onDraftChange={setDraft} />}
    </>;
  }
  render(<QueryClientProvider client={new QueryClient()}><Host /></QueryClientProvider>);
  await user.click(screen.getByText('Test agent'));
  await user.type(screen.getByPlaceholderText('Description...'), 'kept');
  await user.click(screen.getByRole('button', { name: 'toggle' }));
  await user.click(screen.getByRole('button', { name: 'toggle' }));
  expect(screen.getByPlaceholderText('Description...')).toHaveValue('kept');
});

test('reload home data reads the agent memory again', async () => {
  mocks.agents = [{ id: 'agent' }];
  const getMemory = vi.fn().mockResolvedValue({ user: '', memory: '' });
  const sdkClient = {
    http: {
      agents: { getMemory, listSkills: vi.fn().mockResolvedValue({ skills: [] }) },
      sessions: {
        codexCatalog: vi.fn().mockResolvedValue({ models: [] }),
        claudeCatalog: vi.fn().mockResolvedValue({ models: [] }),
      },
    },
  } as unknown as ProkopaiClient;
  const user = userEvent.setup();
  renderPanel(sdkClient);
  await user.click(screen.getByText('Test agent'));
  await waitFor(() => expect(getMemory).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole('button', { name: /^Home & Memory/ }));
  await user.click(await screen.findByTitle('Reload home data'));
  await waitFor(() => expect(getMemory).toHaveBeenCalledTimes(2));
});
