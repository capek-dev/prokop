import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Preconfig } from '@prokopai/sdk';
import { ModelVariantConfigSelector } from '@/components/chat/ModelVariantConfigSelector';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const preconfigs = [
  { id: 'agent-a', name: 'Agent A' },
  { id: 'agent-b', name: 'Agent B' },
] as Preconfig[];

test('Codex picker retains agent identity and offers the same preconfig selection', async () => {
  const onChangePreconfig = vi.fn();
  render(<ModelVariantConfigSelector models={[]} selectedModelId="codex" selectedVariant={null}
    onChangeModel={vi.fn()} onChangeVariant={vi.fn()} codexSession
    codexSelectedModel="codex" preconfigs={preconfigs} selectedPreconfigId="agent-a"
    onChangePreconfig={onChangePreconfig} />);
  const trigger = screen.getByRole('combobox', { name: /Agent A/ });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button', { name: /Config/ }));
  fireEvent.click(await screen.findByText('Agent B'));
  expect(onChangePreconfig).toHaveBeenCalledWith('agent-b');
});
