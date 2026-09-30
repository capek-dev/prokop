import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ProkopaiClient, PromptInfo, Session } from '@prokopai/sdk';
import { MessageInput } from '@/components/chat/MessageInput';
import { clearDraft } from '@/config/draftStorage';

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
  clearDraft(session.id);
});

function setup(prompts?: PromptInfo[]) {
  URL.createObjectURL = vi.fn(() => 'blob:image');
  URL.revokeObjectURL = vi.fn();
  const upload = vi.fn(async (_id: string, file: File) => ({
    id: `uploaded-${file.name}`, kind: 'image', filename: file.name, size: file.size,
  }));
  const onSendMessage = vi.fn();
  const client = { http: { attachments: { upload } } } as unknown as ProkopaiClient;
  const view = render(<MessageInput session={session} sessionId={session.id} workspaceId="ws"
    sdkClient={client} prompts={prompts} onSendMessage={onSendMessage} modelSupportsImage={false} />);
  const fileInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
  return { fileInput, upload, onSendMessage, view };
}

test('Claude Goal sends a condition without Codex limits and shows native checks', async () => {
  const { onSendMessage, view } = setup();
  const claude = { ...session, harness: 'claude-cli', id: 'claude-goal-test' } as Session;
  view.rerender(<MessageInput session={claude} sessionId={session.id} workspaceId="ws"
    onSendMessage={onSendMessage} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Send mode: chat' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Goal' }));
  expect(screen.queryByLabelText('Token budget')).not.toBeInTheDocument();
  expect(screen.queryByText('Max turns')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('Type the completion condition...'),
    { target: { value: 'Tests pass' } });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Set goal' }));
  expect(onSendMessage).toHaveBeenCalledWith('Tests pass', undefined, undefined, { condition: 'Tests pass' });
  view.rerender(<MessageInput session={{ ...claude, harnessState: { goal: { status: 'active', objective: 'Tests pass',
    progress: { kind: 'iterations', current: 1, max: null } } } as Session['harnessState'] } as Session}
    sessionId={session.id} workspaceId="ws" onSendMessage={onSendMessage} />);
  expect(screen.getByText('active · 1 checks')).toBeInTheDocument();
  view.rerender(<MessageInput session={{ ...claude, harnessState: { goal: { status: 'ended', objective: 'Tests pass',
    progress: { kind: 'iterations', current: 2, max: null } } } as Session['harnessState'] } as Session}
    sessionId={session.id} workspaceId="ws" onSendMessage={onSendMessage} />);
  expect(screen.queryByText('ended · 2 checks')).not.toBeInTheDocument();
  expect(screen.queryByText('Tests pass')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Message Claude CLI (text and images)')).not.toBeDisabled();
});

test('Codex Goal sends a token budget separately from max turns', async () => {
  const { onSendMessage } = setup();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Send mode: chat' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Goal' }));
  const budget = screen.getByLabelText('Token budget') as HTMLInputElement;
  expect(budget.value).toBe('50000');
  fireEvent.change(budget, { target: { value: '0' } });
  fireEvent.change(screen.getByPlaceholderText('Type the completion condition...'), { target: { value: 'Ship it' } });
  const sendGoal = document.querySelector('button[aria-label="Set goal"]') as HTMLButtonElement;
  expect(sendGoal).toBeDisabled();
  fireEvent.change(budget, { target: { value: '25000' } });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  fireEvent.click(sendGoal);
  expect(onSendMessage).toHaveBeenCalledWith('Ship it', undefined, undefined,
    { condition: 'Ship it', tokenBudget: 25000 });
});

test('an active Codex Goal shows usage and disables the composer', () => {
  const { onSendMessage, view } = setup();
  view.rerender(<MessageInput session={{ ...session, harnessState: { goal: { status: 'active', objective: 'Ship it',
    progress: { kind: 'tokens', current: 123, max: 50000 } } } as Session['harnessState'] } as Session}
    sessionId={session.id} workspaceId="ws"
    onSendMessage={onSendMessage} />);
  expect(screen.getByText('123/50,000 tokens', { exact: false })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Goal active')).toBeDisabled();
});

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
  const textarea = screen.getByPlaceholderText('Message Codex CLI (/ prompts, @ files)');
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

test('Codex expands a prompt while preserving an uploaded image', async () => {
  const { fileInput, onSendMessage } = setup([
    { name: 'describe', description: 'Describe image', content: 'Describe this image' },
  ]);
  await act(async () => {
    fireEvent.change(fileInput, { target: { files: [new File(['img'], 'c.png', { type: 'image/png' })] } });
  });
  fireEvent.change(screen.getByPlaceholderText('Message Codex CLI (/ prompts, @ files)'),
    { target: { value: '/describe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledWith('Describe this image', [{ id: 'uploaded-c.png', kind: 'image' }]);
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
