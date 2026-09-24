import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { CodexModelSelector } from '@/components/chat/CodexModelSelector';

const models = [
  { model: 'codex-one', name: 'Codex One', supportedEfforts: ['low', 'medium'], defaultEffort: 'low', isDefault: true },
  { model: 'codex-two', name: 'Codex Two', supportedEfforts: ['medium', 'high'], defaultEffort: 'high', isDefault: false },
];

describe('CodexModelSelector', () => {
  test('switching models uses the new model default rather than carrying prior effort', async () => {
    const codexModels = vi.fn().mockResolvedValue({ models, selection: { model: 'codex-one', effort: 'medium' } });
    const setCodexModel = vi.fn().mockResolvedValue({ selection: { model: 'codex-two', effort: 'high' } });
    const client = { http: { sessions: { codexModels, setCodexModel } } } as unknown as ProkopaiClient;
    const session = { id: 'session', harness: 'codex-cli', selectedModel: 'codex-one' } as Session;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>
      <CodexModelSelector session={session} client={client} serverUrl="https://example.test" disabled={false} />
    </QueryClientProvider>);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Codex model and effort' }))
      .toHaveTextContent('Codex One (medium)'));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Choose Codex model and effort' }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' });
    fireEvent.click(await screen.findByText('Codex Two'));
    await waitFor(() => expect(setCodexModel).toHaveBeenCalledWith('session', { model: 'codex-two', effort: 'high' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose Codex model and effort' }))
      .toHaveTextContent('Codex Two (high)'));
  });
});
