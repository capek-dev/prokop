import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { AutoApproveSelector } from '@/components/chat/AutoApproveSelector';
import { useSessionStore } from '@/stores/sessionStore';

const originalSessions = useSessionStore.getState().sessions;
afterEach(() => { useSessionStore.setState({ sessions: originalSessions }); });

test('Codex session shield updates the persisted risk ceiling and explains native approvals', async () => {
  const session = { id: 'codex', harness: 'codex-cli', autoApproveSeverity: 'low' } as Session;
  useSessionStore.setState({ sessions: [session] });
  const update = vi.fn().mockResolvedValue({ session: { ...session, autoApproveSeverity: 'medium' } });
  const client = { http: { sessions: { update } } } as unknown as ProkopaiClient;
  render(<AutoApproveSelector sessionId="codex" sdkClient={client} />);
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Auto-approve: low risk and below' }),
      { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  expect(await screen.findByText('Critical native approvals still ask.', { exact: false })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByText('Auto-approve permissions with medium risk and below.'));
  });
  await waitFor(() => expect(update).toHaveBeenCalledWith('codex', { autoApproveSeverity: 'medium' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Auto-approve: medium risk and below' })).toBeInTheDocument());
});
