import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Session } from '@prokopai/sdk';
import { MessageInput } from '@/components/chat/MessageInput';
import { clearDraft } from '@/config/draftStorage';

vi.mock('@/components/worktrees/SessionCheckoutSelector', () => ({
  SessionCheckoutSelector: () => null,
  SessionCheckoutStrip: () => null,
}));
vi.mock('@/components/chat/AutoApproveSelector', () => ({
  AutoApproveSelector: ({ sessionId }: { sessionId: string }) =>
    <button type="button" aria-label={`Auto-approve settings for ${sessionId}`} />,
}));
vi.mock('@/hooks/queries', () => ({ useResponseFormatsQuery: () => ({ data: { formats: [] } }) }));

const session = { id: 'claude-text-input-test', workspaceId: 'ws',
  harness: 'claude-cli', status: 'active' } as Session;
afterEach(() => clearDraft(session.id));

test('Claude composer sends a trimmed text message with no extra options', () => {
  const onSendMessage = vi.fn();
  render(<MessageInput session={session} sessionId={session.id} workspaceId="ws"
    onSendMessage={onSendMessage} />);
  expect(screen.getByRole('button', { name: `Auto-approve settings for ${session.id}` })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Message Claude CLI (text only)'),
    { target: { value: '  Hello Claude  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('Hello Claude');
});
