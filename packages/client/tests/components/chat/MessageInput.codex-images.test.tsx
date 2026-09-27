import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, Session } from '@prokopai/sdk';
import { MessageInput } from '@/components/chat/MessageInput';

vi.mock('@/components/worktrees/SessionCheckoutSelector', () => ({
  SessionCheckoutSelector: () => null,
  SessionCheckoutStrip: () => null,
}));
vi.mock('@/components/chat/AutoApproveSelector', () => ({ AutoApproveSelector: () => null }));
vi.mock('@/hooks/queries', () => ({ useResponseFormatsQuery: () => ({ data: { formats: [] } }) }));

const session = { id: 'codex-image-test', workspaceId: 'ws', harness: 'codex-cli', status: 'active' } as Session;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

function setup() {
  URL.createObjectURL = vi.fn(() => 'blob:image');
  URL.revokeObjectURL = vi.fn();
  const upload = vi.fn(async (_id: string, file: File) => ({
    id: `uploaded-${file.name}`, kind: 'image', filename: file.name, size: file.size,
  }));
  const onSendMessage = vi.fn();
  const client = { http: { attachments: { upload } } } as unknown as ProkopaiClient;
  const view = render(<MessageInput session={session} sessionId={session.id} workspaceId="ws"
    sdkClient={client} onSendMessage={onSendMessage} modelSupportsImage={false} />);
  const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { fileInput, upload, onSendMessage, view };
}

test('Codex picker accepts images and sends image-only messages', async () => {
  const { fileInput, upload, onSendMessage } = setup();
  expect(screen.getByRole('button', { name: 'Attach file' })).toBeInTheDocument();
  expect(fileInput.accept).toBe('image/png,image/jpeg,image/webp,image/gif');
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [new File(['img'], 'a.png', { type: 'image/png' })] } });
  });
  expect(upload).toHaveBeenCalledTimes(1);
  expect(screen.getByAltText('a.png')).toBeInTheDocument();
  expect(screen.queryByText(/will not inspect images/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledWith('', [{ id: 'uploaded-a.png', kind: 'image' }]);
});

test('Codex paste and drop ignore non-images while keeping image with text', async () => {
  const { view, upload, onSendMessage } = setup();
  const textarea = screen.getByPlaceholderText('Message Codex CLI (@ files)');
  const file = new File(['text'], 'note.txt', { type: 'text/plain' });
  const image = new File(['img'], 'b.webp', { type: 'image/webp' });
  await act(async () => {
    fireEvent.paste(textarea, { clipboardData: { files: [file, image] } });
  });
  expect(upload).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.drop(view.container.querySelector('form')!, { dataTransfer: { files: [file] } });
  });
  expect(upload).toHaveBeenCalledTimes(1);
  fireEvent.change(textarea, { target: { value: 'Describe this' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledWith('Describe this', [{ id: 'uploaded-b.webp', kind: 'image' }]);
});

test('Codex cannot send an image before its upload completes', async () => {
  let finish!: (value: { id: string; kind: string; filename: string; size: number }) => void;
  const { fileInput, upload, onSendMessage } = setup();
  upload.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.change(fileInput, { target: { files: [new File(['img'], 'slow.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled());
  await act(async () => { finish({ id: 'uploaded-slow.png', kind: 'image', filename: 'slow.png', size: 3 }); });
  expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
  expect(onSendMessage).not.toHaveBeenCalled();
});
