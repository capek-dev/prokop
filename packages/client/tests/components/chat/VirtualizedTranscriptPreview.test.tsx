import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ToolPart } from '@prokopai/sdk';
import { VirtualizedTranscript } from '@/components/chat/VirtualizedTranscript';
import type { DisplayItem } from '@/components/chat/VirtualizedTranscript';

const { listProps } = vi.hoisted(() => ({ listProps: vi.fn() }));
vi.mock('@legendapp/list/react', () => ({
  LegendList: (props: { data: DisplayItem[]; renderItem: (props: { item: DisplayItem }) => ReactNode }) => {
    listProps(props);
    return <>{props.data.map(item => <div key={item.message.id}>{props.renderItem({ item })}</div>)}</>;
  },
}));
vi.mock('@/components/chat/MessageBubble', () => ({ MessageBubble: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/chat/SelectedContext', () => ({ SelectedContext: ({ messageId }: { messageId: string }) => <div data-testid={`context-${messageId}`} /> }));
vi.mock('@/components/chat/ToolCall', () => ({
  ToolCall: ({ part, collapsePreview }: { part: ToolPart; collapsePreview: boolean }) =>
    <div data-testid={part.id} data-collapsed={String(collapsePreview)} />,
}));
vi.mock('@/components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/visualizations', () => ({ StructuredResponse: () => null }));
afterEach(cleanup);

function user(id: string, isQueued = false): DisplayItem {
  return { message: { id, sessionId: 's', createdAt: 1, role: 'user' }, parts: [], isQueued };
}
function assistant(id: string, running = false): DisplayItem {
  return {
    message: {
      id, sessionId: 's', createdAt: 1, role: 'assistant', status: 'completed',
      modelId: 'test', providerId: 'test', tokens: { prompt: 0, completion: 0 }, cost: 0,
    },
    parts: [{ id: `tool-${id}`, messageId: id, type: 'tool', name: 'test', callId: id, createdAt: 1,
      state: running
        ? { status: 'running', input: {}, startedAt: 1 }
        : { status: 'completed', input: {}, output: null, startedAt: 1, completedAt: 2 },
    }],
  };
}
const pendingAskRequests: [] = [];
const onAskResponse = () => {};
function transcript(items: DisplayItem[]) {
  return <VirtualizedTranscript displayItems={items} messagesWithParts={items} sessionId="s"
    pendingAskRequests={pendingAskRequests} onAskResponse={onAskResponse} autoFollow={false} />;
}

test('failed and compact-failed invocations expose their own context control', () => {
  const failed = assistant('failed');
  const compact = assistant('compact');
  if (failed.message.role !== 'assistant' || compact.message.role !== 'assistant') throw new Error('invalid fixture');
  failed.message.status = 'error';
  failed.parts = [];
  compact.message.mode = 'compact_failed';
  render(transcript([failed, compact]));
  expect(screen.getByTestId('context-failed')).toBeInTheDocument();
  expect(screen.getByTestId('context-compact')).toBeInTheDocument();
});

test('cutoff changes reach mounted memoized rows, while queued prompts and running tools are unaffected', () => {
  const items = [user('u1'), assistant('a1'), assistant('running', true), user('u2'), assistant('a2')];
  const view = render(transcript(items));
  expect(listProps).toHaveBeenLastCalledWith(expect.objectContaining({
    maintainVisibleContentPosition: { data: true, size: true },
  }));
  expect(screen.getByTestId('tool-a1')).toHaveAttribute('data-collapsed', 'false');
  view.rerender(transcript([...items, user('queued', true)]));
  expect(screen.getByTestId('tool-a1')).toHaveAttribute('data-collapsed', 'false');
  view.rerender(transcript([...items, user('u3')]));
  expect(screen.getByTestId('tool-a1')).toHaveAttribute('data-collapsed', 'false');
  view.rerender(transcript([...items, user('u3'), user('u4')]));
  expect(screen.getByTestId('tool-a1')).toHaveAttribute('data-collapsed', 'true');
  expect(screen.getByTestId('tool-a2')).toHaveAttribute('data-collapsed', 'false');
  expect(screen.getByTestId('tool-running')).toHaveAttribute('data-collapsed', 'false');
});
