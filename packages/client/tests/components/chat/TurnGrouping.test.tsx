import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AssistantMessage, Part, ToolPart, ToolState } from '@prokopai/sdk';
import { VirtualizedTranscript } from '@/components/chat/VirtualizedTranscript';
import type { DisplayItem } from '@/components/chat/VirtualizedTranscript';

vi.mock('@legendapp/list/react', () => ({
  LegendList: (props: { data: DisplayItem[]; renderItem: (props: { item: DisplayItem }) => ReactNode }) =>
    <>{props.data.map(item => <div key={item.message.id}>{props.renderItem({ item })}</div>)}</>,
}));
vi.mock('@/components/chat/MessageBubble', () => ({ MessageBubble: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/chat/ToolCall', () => ({
  ToolCall: ({ part }: { part: ToolPart }) => <div data-testid={part.id} />,
}));
vi.mock('@/components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('@/components/visualizations', () => ({ StructuredResponse: () => null }));
afterEach(cleanup);

const completed: ToolState = { status: 'completed', input: {}, output: null, startedAt: 1_000, completedAt: 2_000 };

function tool(id: string, state: ToolState = completed): ToolPart {
  return { id, messageId: 'a', createdAt: 1, type: 'tool', name: 'read', callId: id, state };
}
function text(id: string, value: string, createdAt = 1): Part {
  return { id, messageId: 'a', createdAt, type: 'text', text: value };
}
function reasoning(id: string, value: string, createdAt = 1): Part {
  return { id, messageId: 'a', createdAt, type: 'reasoning', text: value };
}
function turn(parts: Part[], status: AssistantMessage['status'] = 'completed'): DisplayItem {
  return {
    message: {
      id: 'a', sessionId: 's', createdAt: 1, role: 'assistant', status,
      modelId: 'm', providerId: 'p', tokens: { prompt: 0, completion: 0 }, cost: 0,
    },
    parts,
  };
}
function transcript(sessionId: string, item: DisplayItem) {
  return <VirtualizedTranscript displayItems={[item]} messagesWithParts={[item]} sessionId={sessionId} autoFollow={false} />;
}

test('a finished turn folds its tool calls into one row and keeps the answer visible', () => {
  render(transcript('fold', turn([tool('t1'), tool('t2'), text('answer', 'Done.')])));

  expect(screen.getByText('2 tool calls')).toBeInTheDocument();
  expect(screen.getByText('Done.')).toBeInTheDocument();
  expect(screen.queryByTestId('t1')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /2 tool calls/ }));
  expect(screen.getByTestId('t1')).toBeInTheDocument();
  expect(screen.getByTestId('t2')).toBeInTheDocument();
});

test('the group stays open while the agent works in it and folds when the answer starts', () => {
  const working = turn([tool('t1'), tool('t2')], 'streaming');
  const view = render(transcript('live', working));
  expect(screen.getByTestId('t2')).toBeInTheDocument();

  view.rerender(transcript('live', turn([tool('t1'), tool('t2'), text('answer', 'Here it is')], 'streaming')));
  expect(screen.queryByTestId('t2')).not.toBeInTheDocument();
  expect(screen.getByText('Here it is')).toBeInTheDocument();
});

test('a running tool keeps a finished turn group open', () => {
  render(transcript('running', turn([tool('t1'), tool('t2', { status: 'running', input: {}, startedAt: 1 })])));
  expect(screen.getByTestId('t2')).toBeInTheDocument();
});

test('a user toggle wins over the live default', () => {
  const view = render(transcript('toggle', turn([tool('t1'), tool('t2')], 'streaming')));
  fireEvent.click(screen.getByRole('button', { name: /2 tool calls/ }));
  expect(screen.queryByTestId('t1')).not.toBeInTheDocument();

  view.rerender(transcript('toggle', turn([tool('t1'), tool('t2'), tool('t3')], 'streaming')));
  expect(screen.queryByTestId('t1')).not.toBeInTheDocument();
});

test('finished reasoning folds to a Thought toggle; live reasoning streams open', () => {
  const finished = turn([reasoning('r1', 'Checking the cache first', 1_000), text('answer', 'Answer', 13_000)]);
  const view = render(transcript('reasoning', finished));
  expect(screen.queryByText('Checking the cache first')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Thought for 12s' }));
  expect(screen.getByText('Checking the cache first')).toBeInTheDocument();

  view.rerender(transcript('reasoning-live', turn([reasoning('r2', 'Still thinking')], 'streaming')));
  expect(screen.queryByRole('button', { name: /Thought/ })).not.toBeInTheDocument();
});
