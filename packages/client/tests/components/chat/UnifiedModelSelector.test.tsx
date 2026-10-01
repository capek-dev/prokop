import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ModelVariantConfigSelector } from '@/components/chat/ModelVariantConfigSelector';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const prokop = [{ id: 'shared', name: 'Provider Model', contextWindow: 1000,
  providerId: 'provider', providerName: 'Provider' }];
const codex = [{ model: 'shared', name: 'Codex Model', defaultEffort: 'medium',
  supportedEfforts: ['medium', 'high'], isDefault: true }];

function picker(props: { codexSession?: boolean; models?: typeof prokop; codexModels?: typeof codex }) {
  const onChangeModel = vi.fn();
  const onChangeCodex = vi.fn();
  render(<ModelVariantConfigSelector
    models={props.models ?? prokop}
    codexModels={props.codexModels ?? codex}
    codexSession={props.codexSession}
    codexSelectedModel="shared"
    codexEffort="medium"
    selectedModelId="shared"
    selectedProviderId="provider"
    onChangeModel={onChangeModel}
    onChangeCodex={onChangeCodex}
    selectedVariant={null}
    onChangeVariant={vi.fn()}
    preconfigs={[]}
    selectedPreconfigId={null}
    onChangePreconfig={vi.fn()}
  />);
  return { onChangeModel, onChangeCodex };
}

test('one model list keeps provider and Codex IDs separate', async () => {
  const { onChangeModel, onChangeCodex } = picker({});
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('button', { name: /Model Provider Model/ }));
  fireEvent.click(await screen.findByText('Codex Model'));
  expect(onChangeCodex).toHaveBeenCalledWith('shared', 'medium');
  expect(onChangeModel).not.toHaveBeenCalled();
});

test('established Codex session shows only Codex choices and effort', async () => {
  const { onChangeModel, onChangeCodex } = picker({ codexSession: true, models: [] });
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(screen.getByRole('button', { name: /Effort Medium/ }));
  fireEvent.click(await screen.findByText('High'));
  expect(onChangeCodex).toHaveBeenCalledWith('shared', 'high');
  expect(onChangeModel).not.toHaveBeenCalled();
  expect(screen.queryByText('Provider Model')).not.toBeInTheDocument();
});
