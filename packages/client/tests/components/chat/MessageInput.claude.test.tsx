import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
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

test.each(['codex-cli', 'claude-cli'] as const)('%s composer queues during a turn and keeps Stop when empty', harness => {
  const onSendMessage = vi.fn();
  const onStopStreaming = vi.fn();
  const view = render(<MessageInput session={{ ...session, harness }} sessionId={session.id} workspaceId="ws"
    isStreaming onStopStreaming={onStopStreaming} onSendMessage={onSendMessage} />);
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  const textarea = view.container.querySelector('textarea')!;
  fireEvent.change(textarea, { target: { value: '  next instruction  ' } });
  expect(screen.getByRole('button', { name: 'Queue message' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));
  expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('next instruction', undefined);
  fireEvent.change(textarea, { target: { value: 'another instruction' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(onSendMessage).toHaveBeenLastCalledWith('another instruction', undefined);
  expect(onSendMessage).toHaveBeenCalledTimes(2);
  expect(onStopStreaming).not.toHaveBeenCalled();
});

test('Claude composer sends a trimmed text message with no extra options', () => {
  const onSendMessage = vi.fn();
  render(<MessageInput session={session} sessionId={session.id} workspaceId="ws"
    onSendMessage={onSendMessage} />);
  expect(screen.getByRole('button', { name: `Auto-approve settings for ${session.id}` })).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Message Claude CLI (text and images)'),
    { target: { value: '  Hello Claude  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('Hello Claude', undefined);
});
test.each(['codex-cli', 'claude-cli'] as const)('%s composer queues image-only input after upload', async harness => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:image');
  URL.revokeObjectURL = vi.fn();
  try {
    const upload = vi.fn(async (_sessionId: string, file: File) => ({
      id: 'uploaded-image', kind: 'image', filename: file.name, size: file.size,
    }));
    const client = { http: { attachments: { upload } } } as unknown as ProkopaiClient;
    const onSendMessage = vi.fn();
    const view = render(<MessageInput session={{ ...session, harness }} sessionId={session.id} workspaceId="ws"
      isStreaming onStopStreaming={vi.fn()} sdkClient={client} onSendMessage={onSendMessage} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] } });
    });
    expect(upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Queue message' }));
    expect(onSendMessage).toHaveBeenCalledExactlyOnceWith('', [{ id: 'uploaded-image', kind: 'image' }]);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
