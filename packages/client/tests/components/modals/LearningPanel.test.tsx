import { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { LearningReviewer, Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), claudeCatalog: vi.fn(), codexCatalog: vi.fn() }));

vi.mock('@/contexts/ServerClientContext', () => ({
  useSdkClient: () => ({ http: {
    workspaces: { previewLearning: mocks.preview },
    sessions: { claudeCatalog: mocks.claudeCatalog, codexCatalog: mocks.codexCatalog },
  } }),
}));

vi.mock('@/components/modals/configuration/LearningHistory', () => ({ LearningHistory: () => null }));

const state = vi.hoisted(() => ({
  models: [] as never[],
  workspaces: [{ id: 'other', name: 'Other', path: '/other', settings: {} }] as never[],
}));

vi.mock('@/stores/serverDataStore', () => ({
  useServerDataStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import { LearningPanel } from '@/components/modals/configuration/LearningPanel';

const preconfigs: Preconfig[] = [
  { id: 'main', name: 'Main', mode: 'primary', model: 'm1', provider: 'p1' } as Preconfig,
  { id: 'alt', name: 'Alt', mode: 'primary', model: 'm2', provider: 'p2' } as Preconfig,
  { id: 'claude-agent', name: 'ClaudeAgent', mode: 'primary', model: 'claude-opus-4-6', provider: '', modelHarness: 'claude-cli' } as Preconfig,
];

const workspace = (settings: Partial<Workspace['settings']>): Workspace =>
  ({ id: 'ws', name: 'Demo', path: '/demo', settings: { preconfigs: { defaultId: 'main', selectedIds: null }, ...settings } }) as Workspace;

function Harness(props: { workspace: Workspace; initial?: WorkspaceLearningSettings; allowPersonalLearning?: boolean }) {
  const [value, setValue] = useState(props.initial);
  const [allow, setAllow] = useState(props.allowPersonalLearning ?? true);
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={cache}>
    <LearningPanel workspace={props.workspace} preconfigs={preconfigs} value={value} allowPersonalLearning={allow}
      onChange={setValue} onPersonalLearningChange={setAllow} />
  </QueryClientProvider>;
}

beforeEach(() => {
  mocks.preview.mockReset();
  mocks.claudeCatalog.mockReset();
  mocks.codexCatalog.mockReset();
});

test('disabled state shows the two gates and hides reviewer configuration', () => {
  render(<Harness workspace={workspace({})} />);
  expect(screen.getByRole('switch', { name: 'Automatic learning' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Use as personal learning source' })).toBeChecked();
  expect(screen.queryByText('Learning focus')).toBeNull();
  expect(screen.getByRole('button', { name: /learning history/i })).toBeInTheDocument();
});

test('enabling seeds one reviewer with the default preconfig and exposes every setting', async () => {
  const user = userEvent.setup();
  render(<Harness workspace={workspace({})} />);
  await user.click(screen.getByRole('switch', { name: 'Automatic learning' }));
  expect(screen.getByText('Learner 1 · Main')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Learning focus/ }));
  expect(screen.getByRole('textbox', { name: 'Learning focus' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Timing/ }));
  expect(screen.getByLabelText('Quiet period')).toHaveValue(30);
  expect(screen.getByLabelText('Min interval')).toHaveValue(120);
  expect(screen.getByLabelText('Max pending age')).toHaveValue(1440);
  expect(screen.getByRole('switch', { name: 'Improve skills' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Shared instructions/ })).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Shared instructions' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Shared instructions/ }));
  expect(screen.getByRole('textbox', { name: 'Shared instructions' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add learner' })).toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: 'Use as personal learning source' })).not.toBeNull();
});

test('agent home points to the agent editor instead of the learning form', async () => {
  render(<Harness workspace={workspace({ isAgentHome: true, agentId: 'home-agent' })} />);
  // Agent learning is configured on the agent itself now; the workspace
  // panel only points there and keeps the history browser reachable.
  expect(screen.getByRole('alert')).toHaveTextContent('Agent learning is configured on the agent');
  expect(screen.queryByRole('switch', { name: 'Automatic learning' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Use as personal learning source' })).toBeNull();
  expect(screen.queryByText('Learners')).toBeNull();
  expect(screen.getByRole('button', { name: 'Learning history' })).toBeInTheDocument();
});

test('tuning stays collapsed by default and recaps custom values on the triggers', async () => {
  const user = userEvent.setup();
  const initial = (reviewer: Partial<LearningReviewer>): WorkspaceLearningSettings => ({ enabled: true, reviewers: [{ id: 'r1', preconfigId: 'main', instructions: '', modelOverride: null, cadence: null, ...reviewer }], improveSkills: false, instructions: '', sources: { mode: 'all' } });
  const first = render(<Harness workspace={workspace({})} initial={initial({})} />);
  expect(screen.getByRole('button', { name: /^Learning focus/ }).textContent).toBe('Learning focus');
  expect(screen.queryByRole('textbox', { name: 'Learning focus' })).toBeNull();
  expect(screen.queryByLabelText('Quiet period')).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Timing/ }));
  expect(screen.getByLabelText('Quiet period')).toHaveValue(30);
  first.unmount();

  render(<Harness workspace={workspace({})} initial={initial({ instructions: 'Focus on tests' })} />);
  expect(screen.getByRole('button', { name: /^Learning focus/ })).toHaveTextContent('Focus on tests');
  expect(screen.getByRole('textbox', { name: 'Learning focus' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Quiet period')).toBeNull();
  cleanup();

  render(<Harness workspace={workspace({})} initial={initial({ cadence: { idleMinutes: 5, minimumIntervalMinutes: 120, maximumPendingMinutes: 1440 } })} />);
  expect(screen.getByRole('button', { name: /^Timing/ })).toHaveTextContent('5m · 2h · 1d');
  expect(screen.getByLabelText('Quiet period')).toHaveValue(5);
});

test('a harness-pinned learner inherits its harness model and can override to any harness', async () => {
  const user = userEvent.setup();
  mocks.claudeCatalog.mockResolvedValue({
    models: [{ model: 'claude-opus-4-6', name: 'Opus 4.6', supportedEfforts: ['low', 'high'], defaultEffort: 'high', isDefault: true }],
  });
  mocks.codexCatalog.mockResolvedValue({
    models: [{ model: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: true }],
  });
  const initial = { enabled: true,
    reviewers: [{ id: 'r1', preconfigId: 'claude-agent', instructions: '', modelOverride: null, cadence: null }],
    improveSkills: false, instructions: '', sources: { mode: 'all' } } as WorkspaceLearningSettings;
  const { container } = render(<Harness workspace={workspace({})} initial={initial} />);
  void container;
  // Inherit state: the agent default is the pinned Claude model.
  expect(await screen.findByText('Agent default: Claude CLI · Opus 4.6')).toBeInTheDocument();
  expect(screen.getByText(/Reviews run on Claude CLI with this model/)).toBeInTheDocument();
  expect(screen.getByText(/can't be undone from history/)).toBeInTheDocument();

  // Override to a Codex model: the picker offers every harness.
  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await user.click(screen.getByRole('tab', { name: 'Codex' }));
  await user.click(screen.getByText('GPT 5.2 Codex'));
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Codex · GPT 5.2 Codex');
  expect(screen.getByText(/Reviews run on Codex CLI with this model/)).toBeInTheDocument();
});

test('an unpinned learner keeps the inherit row and resolves the agent default from the prokop catalog', async () => {
  render(<Harness workspace={workspace({})} initial={{ enabled: true,
    reviewers: [{ id: 'r1', preconfigId: 'main', instructions: '', modelOverride: null, cadence: null }],
    improveSkills: false, instructions: '', sources: { mode: 'all' } }} />);
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Use agent default');
  expect(screen.queryByText(/Reviews run on/)).toBeNull();
  // Catalogs are fetched whenever learners exist: any of them may override to a harness.
  await waitFor(() => expect(mocks.claudeCatalog).toHaveBeenCalled());
  expect(mocks.codexCatalog).toHaveBeenCalled();
});

test('preview opens a dialog with the reviewer prompt', async () => {
  const user = userEvent.setup();
  mocks.preview.mockResolvedValue({ prompt: 'You are a reviewer.' });
  render(<Harness workspace={workspace({})} initial={{ enabled: true, reviewers: [{ id: 'r1', preconfigId: 'main', instructions: '', modelOverride: null, cadence: null }], improveSkills: false, instructions: '', sources: { mode: 'all' } }} />);
  await user.click(screen.getByRole('button', { name: /preview prompt/i }));
  expect(await screen.findByText('You are a reviewer.')).toBeInTheDocument();
  expect(screen.getByText('Prompt preview')).toBeInTheDocument();
  expect(mocks.preview).toHaveBeenCalledWith('ws', expect.objectContaining({ enabled: true }), 'r1');
});

test('history opens in a dialog instead of inline', async () => {
  const user = userEvent.setup();
  render(<Harness workspace={workspace({})} />);
  await user.click(screen.getByRole('button', { name: /learning history/i }));
  expect(screen.getByText('Learning runs and revision-checked undo.')).toBeInTheDocument();
});