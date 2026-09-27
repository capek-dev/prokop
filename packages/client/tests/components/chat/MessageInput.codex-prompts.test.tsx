import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { PromptInfo, Session } from '@prokopai/sdk';
import { MessageInput } from '@/components/chat/MessageInput';
import { clearDraft } from '@/config/draftStorage';

vi.mock('@/components/worktrees/SessionCheckoutSelector', () => ({
  SessionCheckoutSelector: () => null,
  SessionCheckoutStrip: () => null,
}));
vi.mock('@/components/chat/AutoApproveSelector', () => ({ AutoApproveSelector: () => null }));
vi.mock('@/hooks/queries', () => ({ useResponseFormatsQuery: () => ({ data: { formats: [] } }) }));

const session = { id: 'codex-prompts-test', workspaceId: 'ws', harness: 'codex-cli', status: 'active' } as Session;
const prompts: PromptInfo[] = [
  { name: 'review', description: 'Review changes', content: 'Review this change: ARG' },
  { name: 'explain', description: 'Explain changes', content: 'Explain this change' },
];

afterEach(() => clearDraft(session.id));

function setup() {
  const onSendMessage = vi.fn();
  render(<MessageInput session={session} sessionId={session.id} workspaceId="ws"
    prompts={prompts} onSendMessage={onSendMessage} />);
  const textarea = screen.getByPlaceholderText('Message Codex CLI (/ prompts, @ files)') as HTMLTextAreaElement;
  return { textarea, onSendMessage };
}

test('Codex prompt autocomplete selects a slash command and expands its arguments on send', async () => {
  const { textarea, onSendMessage } = setup();
  fireEvent.change(textarea, { target: { value: '/rev', selectionStart: 4 } });
  expect(await screen.findByText('/review')).toBeInTheDocument();
  fireEvent.keyDown(textarea, { key: 'Enter' });
  expect(textarea.value).toBe('/review');
  expect(onSendMessage).not.toHaveBeenCalled();
  fireEvent.change(textarea, { target: { value: '/review src/main.ts', selectionStart: 19 } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenCalledWith('Review this change: src/main.ts', undefined);
});

test('Codex sends prompt content with extra text and leaves unknown commands literal', () => {
  const { textarea, onSendMessage } = setup();
  fireEvent.change(textarea, { target: { value: '/explain src/main.ts' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenLastCalledWith('Explain this change\nsrc/main.ts', undefined);
  fireEvent.change(textarea, { target: { value: '/unknown src/main.ts' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(onSendMessage).toHaveBeenLastCalledWith('/unknown src/main.ts', undefined);
});

test('Codex goal keeps the typed condition rather than expanding slash prompts', async () => {
  const { onSendMessage } = setup();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Send mode: chat' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Goal' }));
  const textarea = screen.getByPlaceholderText('Type the completion condition...');
  fireEvent.change(textarea, { target: { value: '/rev', selectionStart: 4 } });
  expect(screen.queryByText('/review')).not.toBeInTheDocument();
  fireEvent.change(textarea, { target: { value: '/review src/main.ts' } });
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set goal' })); });
  expect(onSendMessage).toHaveBeenCalledWith('/review src/main.ts', undefined, undefined,
    { condition: '/review src/main.ts', tokenBudget: 50_000 });
});
