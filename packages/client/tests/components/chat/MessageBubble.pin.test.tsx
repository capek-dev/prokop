import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { Message } from '@prokopai/sdk';
import { MessageBubble } from '@/components/chat/MessageBubble';

const assistant = { id: 'assistant-1', sessionId: 'session-1', role: 'assistant', status: 'completed' } as Message;

test('pinned assistant with fork has one visible Unpin action', () => {
  const togglePin = vi.fn();
  render(<MessageBubble message={assistant} canFork onFork={() => {}} canPin isPinned onTogglePin={togglePin} />);

  expect(screen.getAllByTitle('Unpin message')).toHaveLength(1);
  expect(screen.queryByTitle('Pin message')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Unpin message'));
  expect(togglePin).toHaveBeenCalledOnce();
});

test('pin and unpin occupy the same slot after Fork without moving it', () => {
  const togglePin = vi.fn();
  const props = { message: assistant, canFork: true, onFork: () => {}, canPin: true, onTogglePin: togglePin };
  const { rerender } = render(<MessageBubble {...props} />);
  const fork = screen.getByTitle('Fork from this response');
  const pin = screen.getByTitle('Pin message');
  const row = fork.parentElement;

  expect(row?.children[0]).toBe(fork);
  expect(row?.children[1]).toBe(pin);
  expect(pin).toHaveClass('opacity-0');
  fireEvent.click(pin);
  expect(togglePin).toHaveBeenCalledOnce();

  rerender(<MessageBubble {...props} isPinned />);
  const unpin = screen.getByTitle('Unpin message');
  expect(screen.queryByTitle('Pin message')).not.toBeInTheDocument();
  expect(row?.children[0]).toBe(fork);
  expect(row?.children[1]).toBe(unpin);
  expect(unpin).not.toHaveClass('opacity-0');
});
