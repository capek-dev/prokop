import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Preconfig, Workspace, WorkspaceLearningSettings } from '@prokopai/sdk';

const mocks = vi.hoisted(() => ({ preview: vi.fn() }));

vi.mock('@/contexts/ServerClientContext', () => ({
  useSdkClient: () => ({ http: { workspaces: { previewLearning: mocks.preview } } }),
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
];

const workspace = (settings: Partial<Workspace['settings']>): Workspace =>
  ({ id: 'ws', name: 'Demo', path: '/demo', settings: { preconfigs: { defaultId: 'main', selectedIds: null }, ...settings } }) as Workspace;

function Harness(props: { workspace: Workspace; initial?: WorkspaceLearningSettings; allowPersonalLearning?: boolean }) {
  const [value, setValue] = useState(props.initial);
  const [allow, setAllow] = useState(props.allowPersonalLearning ?? true);
  const cache = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={cache}>
    <LearningPanel workspace={props.workspace} preconfigs={preconfigs} value={value} allowPersonalLearning={allow}
      onChange={setValue} onPersonalLearningChange={setAllow} />
  </QueryClientProvider>;
}

beforeEach(() => {
  mocks.preview.mockReset();
});

test('disabled state shows the two gates and hides reviewer configuration', () => {
  render(<Harness workspace={workspace({})} />);
  expect(screen.getByRole('switch', { name: 'Automatic learning' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Use as personal learning source' })).toBeChecked();
  expect(screen.queryByText('Review focus')).toBeNull();
  expect(screen.getByRole('button', { name: /review history/i })).toBeInTheDocument();
});

test('enabling seeds one reviewer with the default preconfig and exposes every setting', async () => {
  const user = userEvent.setup();
  render(<Harness workspace={workspace({})} />);
  await user.click(screen.getByRole('switch', { name: 'Automatic learning' }));
  expect(screen.getByText('Reviewer 1 · Main')).toBeInTheDocument();
  expect(screen.getByText('Review focus')).toBeInTheDocument();
  expect(screen.getByLabelText('Quiet period (minutes)')).toHaveValue(30);
  expect(screen.getByLabelText('Min interval (minutes)')).toHaveValue(120);
  expect(screen.getByLabelText('Max pending age (minutes)')).toHaveValue(1440);
  expect(screen.getByRole('switch', { name: 'Improve skills' })).toBeInTheDocument();
  expect(screen.getByLabelText('Additional review instructions')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add reviewer' })).toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: 'Use as personal learning source' })).not.toBeNull();
});

test('agent home locks the preconfig, hides source permission, and shows learning sources', async () => {
  const user = userEvent.setup();
  render(<Harness workspace={workspace({ isAgentHome: true, agentId: 'home-agent' })} />);
  await user.click(screen.getByRole('switch', { name: 'Automatic learning' }));
  expect(screen.queryByRole('switch', { name: 'Use as personal learning source' })).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Reviewer preconfig' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Learning sources' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add reviewer' })).toBeNull();
  expect(screen.getByLabelText('Quiet period (minutes)')).toHaveValue(60);
});

test('preview opens a dialog with the reviewer prompt', async () => {
  const user = userEvent.setup();
  mocks.preview.mockResolvedValue({ prompt: 'You are a reviewer.' });
  render(<Harness workspace={workspace({})} initial={{ enabled: true, reviewers: [{ id: 'r1', preconfigId: 'main', instructions: '', modelOverride: null, cadence: null }], improveSkills: false, instructions: '', sources: { mode: 'all' } }} />);
  await user.click(screen.getByRole('button', { name: /preview prompt/i }));
  expect(await screen.findByText('You are a reviewer.')).toBeInTheDocument();
  expect(screen.getByText('Review prompt preview')).toBeInTheDocument();
  expect(mocks.preview).toHaveBeenCalledWith('ws', expect.objectContaining({ enabled: true }), 'r1');
});

test('history opens in a dialog instead of inline', async () => {
  const user = userEvent.setup();
  render(<Harness workspace={workspace({})} />);
  await user.click(screen.getByRole('button', { name: /review history/i }));
  expect(screen.getByText('Learning history')).toBeInTheDocument();
});