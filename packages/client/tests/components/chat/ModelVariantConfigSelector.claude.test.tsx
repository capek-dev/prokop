import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { ModelVariantConfigSelector } from '@/components/chat/ModelVariantConfigSelector';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const claudeModels = [
  { model: 'claude-sonnet-5', name: 'Sonnet 5', isDefault: true,
    defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high'] },
  { model: 'claude-opus-5', name: 'Opus 5', isDefault: false,
    defaultEffort: 'high', supportedEfforts: ['low', 'medium', 'high'] },
];

function picker(onChangeClaude: (model: string, effort: string) => void, claudeSession = false) {
  return <ModelVariantConfigSelector models={[]} selectedModelId={null} selectedVariant={null}
    onChangeModel={vi.fn()} onChangeVariant={vi.fn()} preconfigs={[]}
    selectedPreconfigId={null} onChangePreconfig={vi.fn()}
    claudeModels={claudeModels} claudeSession={claudeSession}
    claudeSelectedModel={claudeSession ? 'claude-opus-5' : null} claudeEffort={claudeSession ? 'high' : null}
    onChangeClaude={onChangeClaude} />;
}

test.each([
  { harness: 'claude', model: 'claude-opus-5', name: 'Opus 5', compact: false },
  { harness: 'claude', model: 'claude-opus-5', name: 'Opus 5', compact: true },
  { harness: 'codex', model: 'gpt-5-codex', name: 'GPT-5 Codex', compact: false },
  { harness: 'codex', model: 'gpt-5-codex', name: 'GPT-5 Codex', compact: true },
])('$harness selected label omits harness prefix (compact=$compact)', ({ harness, model, name, compact }) => {
  const catalog = [{ model, name, isDefault: true, defaultEffort: 'high', supportedEfforts: ['high'] }];
  render(<ModelVariantConfigSelector models={[]} selectedModelId={null} selectedVariant={null}
    onChangeModel={vi.fn()} onChangeVariant={vi.fn()} preconfigs={[]}
    selectedPreconfigId={null} onChangePreconfig={vi.fn()} compact={compact}
    claudeSession={harness === 'claude'} claudeModels={catalog} claudeSelectedModel={model}
    codexSession={harness === 'codex'} codexModels={catalog} codexSelectedModel={model} />);
  const trigger = screen.getByRole('combobox');
  expect(trigger).toHaveTextContent(compact ? name : `${name} · high`);
  expect(trigger).not.toHaveTextContent(/^(Claude|Codex) ·/);
});

test('empty-session picker sends Claude model with default effort', async () => {
  const onChangeClaude = vi.fn();
  render(picker(onChangeClaude));
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: /Model/ }));
  fireEvent.click(await screen.findByText('Opus 5'));
  expect(onChangeClaude).toHaveBeenCalledWith('claude-opus-5', 'high');
});

test('Claude session picker names effort and sends selected model with changed effort', async () => {
  const onChangeClaude = vi.fn();
  render(picker(onChangeClaude, true));
  fireEvent.click(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('button', { name: /Effort/ }));
  fireEvent.click(await screen.findByText('Low'));
  expect(onChangeClaude).toHaveBeenCalledWith('claude-opus-5', 'low');
});
