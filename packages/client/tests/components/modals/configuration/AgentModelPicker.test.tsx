import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { CodexModel, ModelWithStatus } from '@prokopai/sdk';
import { AgentModelPicker, type AgentModelSelection } from '@/components/modals/configuration/AgentModelPicker';

const prokopModel = {
  id: 'glm-5.3',
  name: 'GLM 5.3',
  providerId: 'zhipu-coding',
  providerName: 'Z.AI (Coding Plan)',
  contextWindow: 128000,
  runtimeStatus: { providerSupported: true, providerConfigured: true, usable: true },
  variants: { high: {}, max: {} },
} as unknown as ModelWithStatus;

// A Prokop-catalog provider that shares its name with a harness: the exact
// confusion case the tabs exist for.
const prokopCodexModel = {
  id: 'gpt-5.1',
  name: 'GPT 5.1',
  providerId: 'codex',
  providerName: 'Codex',
  contextWindow: 400000,
  runtimeStatus: { providerSupported: true, providerConfigured: true, usable: true },
  variants: {},
} as unknown as ModelWithStatus;

const codexModels: CodexModel[] = [
  { model: 'gpt-5.2-codex', name: 'GPT 5.2 Codex', supportedEfforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: false },
];

const claudeModels: CodexModel[] = [
  { model: 'claude-opus-4-6', name: 'Opus 4.6', supportedEfforts: ['low', 'high'], defaultEffort: 'high', isDefault: false },
];

function Harness({
  value,
  onChange,
  models = [prokopModel],
}: {
  value: AgentModelSelection;
  onChange: (next: AgentModelSelection) => void;
  models?: ModelWithStatus[];
}) {
  const [state, setState] = useState(value);
  return (
    <AgentModelPicker
      models={models}
      codexModels={codexModels}
      claudeModels={claudeModels}
      value={state}
      onChange={(next) => { onChange(next); setState(next); }}
    />
  );
}

const empty: AgentModelSelection = { model: '', provider: '', variant: '', modelHarness: '' };

test('pins a codex model from the Codex tab with its default effort', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(<Harness value={empty} onChange={change} />);

  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  // Tabs for all three sources; the Prokop tab is active by default and scopes
  // the list, so the CLI model is not visible until its tab is selected.
  expect(screen.getByRole('tab', { name: 'Prokop' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Z.AI (Coding Plan)')).toBeInTheDocument();
  expect(screen.queryByText('GPT 5.2 Codex')).toBeNull();

  await user.click(screen.getByRole('tab', { name: 'Codex' }));
  await user.click(screen.getByText('GPT 5.2 Codex'));

  expect(change).toHaveBeenCalledWith({
    model: 'gpt-5.2-codex', provider: '', variant: 'medium', modelHarness: 'codex-cli',
  });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Codex · GPT 5.2 Codex');
  expect(screen.getByLabelText('Effort')).toHaveTextContent('medium');
});

test('a pinned harness is the active tab on open, and picking a claude model switches efforts', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <Harness
      value={{ model: 'gpt-5.2-codex', provider: '', variant: 'medium', modelHarness: 'codex-cli' }}
      onChange={change}
    />,
  );

  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  expect(screen.getByRole('tab', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true');

  await user.click(screen.getByRole('tab', { name: 'Claude' }));
  await user.click(screen.getByText('Opus 4.6'));

  expect(change).toHaveBeenCalledWith({
    model: 'claude-opus-4-6', provider: '', variant: 'high', modelHarness: 'claude-cli',
  });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Claude · Opus 4.6');
  expect(screen.getByLabelText('Effort')).toHaveTextContent('high');
});

test('a prokop model pins with its first variant key and provider', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(<Harness value={empty} onChange={change} />);

  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await user.click(screen.getByText('GLM 5.3'));

  expect(change).toHaveBeenCalledWith({
    model: 'glm-5.3', provider: 'zhipu-coding', variant: 'high', modelHarness: 'prokop',
  });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('GLM 5.3');
  expect(screen.getByLabelText('Variant')).toHaveTextContent('high');
});

test('clearing back to the server default removes the pin from any tab', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  render(
    <Harness
      value={{ model: 'gpt-5.2-codex', provider: '', variant: 'medium', modelHarness: 'codex-cli' }}
      onChange={change}
    />,
  );

  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  await user.click(screen.getByText('Use server default'));

  expect(change).toHaveBeenCalledWith({ model: '', provider: '', variant: '', modelHarness: '' });
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Use server default');
  expect(screen.queryByLabelText('Effort')).toBeNull();
});

test('a prokop provider named Codex never shows CLI models next to its own', async () => {
  const user = userEvent.setup();
  render(<Harness value={empty} onChange={vi.fn()} models={[prokopModel, prokopCodexModel]} />);

  await user.click(screen.getByRole('combobox', { name: 'Model' }));
  expect(screen.getByText('GPT 5.1')).toBeInTheDocument();
  expect(screen.queryByText('GPT 5.2 Codex')).toBeNull();

  await user.click(screen.getByRole('tab', { name: 'Codex' }));
  expect(screen.getByText('GPT 5.2 Codex')).toBeInTheDocument();
  expect(screen.queryByText('GPT 5.1')).toBeNull();
});

test('empty catalogs render no tabs and only the default row', () => {
  render(
    <AgentModelPicker
      models={[]}
      codexModels={[]}
      claudeModels={[]}
      value={empty}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('Use server default');
});
