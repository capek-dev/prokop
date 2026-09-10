import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { LearningReviewer, ModelWithStatus, Preconfig, Workspace } from '@prokopai/sdk';
import { LearningSourcePicker } from '@/components/modals/configuration/LearningSourcePicker';
import { LearningModelPicker } from '@/components/modals/configuration/LearningModelPicker';

const workspace = (id: string, settings = {}): Workspace => ({ id, name: id, path: `/projects/${id}`, settings } as Workspace);

test('sources search many workspaces without losing selections and respect exclusions', async () => {
  const user = userEvent.setup();
  const items = Array.from({ length: 50 }, (_, i) => workspace(`project-${i}`));
  items.push(workspace('private', { allowPersonalLearning: false }), workspace('home', { isAgentHome: true }));
  function Harness() {
    const [ids, setIds] = useState(['project-1']);
    return <LearningSourcePicker workspaces={items} selectedIds={ids} onChange={setIds} />;
  }
  render(<Harness />);
  expect(screen.getByRole('button', { name: /private/ })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /home/ })).toBeNull();
  const search = screen.getByRole('textbox', { name: 'Search learning sources' });
  await user.type(search, 'project-49');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: /project-49/ }));
  expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  await user.clear(search);
  expect(screen.getByRole('button', { name: 'project-1 /projects/project-1' })).toHaveAttribute('aria-pressed', 'true');
  await user.type(search, 'no-match');
  expect(screen.getByText('No matching workspaces.')).toBeInTheDocument();
});

test('a selected workspace that revoked access can still be removed', async () => {
  const change = vi.fn();
  render(<LearningSourcePicker workspaces={[workspace('private', { allowPersonalLearning: false })]} selectedIds={['private']} onChange={change} />);
  await userEvent.click(screen.getByRole('button', { name: /private/ }));
  expect(change).toHaveBeenCalledWith([]);
});

test('existing model picker selects provider identity, clears stale variant and restores inheritance', async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const models = ['first', 'second'].map(providerId => ({ id: 'shared', name: `${providerId} model`, providerId, providerName: providerId, tier: 'standard', contextWindow: 1000, runtimeStatus: { providerSupported: true, providerConfigured: true, usable: true }, variants: { high: { providerOptions: {} } } })) as ModelWithStatus[];
  function Harness() {
    const [value, setValue] = useState<LearningReviewer['modelOverride']>({ providerId: 'first', modelId: 'shared', variant: 'high' });
    return <LearningModelPicker models={models} preconfig={{ model: 'shared', provider: 'first' } as Preconfig} value={value}
      onChange={next => { change(next); setValue(next); }} />;
  }
  render(<Harness />);
  await user.click(screen.getByRole('combobox', { name: 'Select model' }));
  await user.click(screen.getByRole('option', { name: /second model/ }));
  expect(change).toHaveBeenLastCalledWith({ modelId: 'shared', providerId: 'second', variant: null });
  await user.click(screen.getByRole('button', { name: 'Use preconfig model' }));
  expect(change).toHaveBeenLastCalledWith(null);
  expect(screen.getByText('Using the preconfig model and variant.')).toBeInTheDocument();
});
