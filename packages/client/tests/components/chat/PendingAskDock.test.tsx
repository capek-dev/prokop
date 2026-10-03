import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PendingAskDock, filterDockAskRequests } from '@/components/chat/PendingAskDock';
import { useSessionStore } from '@/stores/sessionStore';
import type { PendingAskRequest } from '@/stores/askStore';

vi.mock('@/components/chat/AskQuestion', () => ({ AskQuestion: ({ request, onRespond }: {
  request: PendingAskRequest;
  onRespond: (toolCallId: string, response: { type: 'confirm'; confirmed: true }, requestId?: string) => void;
}) => <button data-testid="ask-card" onClick={() => onRespond(request.toolCallId,
  { type: 'confirm', confirmed: true }, request.requestId)}>{request.toolCallId}</button> }));

function ask(toolCallId: string, overrides: Partial<PendingAskRequest> = {}): PendingAskRequest {
  return {
    toolCallId,
    requestId: toolCallId,
    sessionId: 'sess',
    toolName: 'shell',
    ask: { type: 'permission', question: toolCallId, resource: 'shell-command', action: 'execute', risk: 'high' },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  useSessionStore.setState({ sessions: [] });
});

test('renders nothing without pending requests', () => {
  const { container } = render(
    <PendingAskDock sessionId="sess" requests={[]} onRespond={() => {}} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test('single request renders the card without a pager', () => {
  render(<PendingAskDock sessionId="sess" requests={[ask('call-1')]} onRespond={() => {}} />);
  expect(screen.getAllByTestId('ask-card')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Previous pending request' })).not.toBeInTheDocument();
  expect(screen.queryByText(/pending/)).not.toBeInTheDocument();
});

test('multiple requests show one card with a pager that navigates and clamps', () => {
  render(
    <PendingAskDock
      sessionId="sess"
      requests={[ask('call-1'), ask('call-2'), ask('call-3')]}
      onRespond={() => {}}
    />,
  );
  // Follow-the-newest: latest card visible, count reflects the queue.
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-3');
  expect(screen.getByText('3 / 3 pending')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Previous pending request' }));
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-2');
  expect(screen.getByText('2 / 3 pending')).toBeInTheDocument();

  // End buttons disable at the boundaries.
  fireEvent.click(screen.getByRole('button', { name: 'Previous pending request' }));
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-1');
  expect(screen.getByRole('button', { name: 'Previous pending request' })).toBeDisabled();

  fireEvent.click(screen.getByRole('button', { name: 'Next pending request' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next pending request' }));
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-3');
  expect(screen.getByRole('button', { name: 'Next pending request' })).toBeDisabled();
});

test('manual navigation pins the card while newer asks arrive', () => {
  const view = render(
    <PendingAskDock sessionId="sess" requests={[ask('call-1'), ask('call-2')]} onRespond={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous pending request' }));
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-1');

  view.rerender(
    <PendingAskDock sessionId="sess" requests={[ask('call-1'), ask('call-2'), ask('call-3')]} onRespond={() => {}} />,
  );
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-1');
  expect(screen.getByText('1 / 3 pending')).toBeInTheDocument();

  // When the pinned card resolves, the dock falls back to the newest.
  view.rerender(
    <PendingAskDock sessionId="sess" requests={[ask('call-2'), ask('call-3')]} onRespond={() => {}} />,
  );
  expect(screen.getByTestId('ask-card')).toHaveTextContent('call-3');
});

test('responding forwards toolCallId and requestId', () => {
  const onRespond = vi.fn();
  render(<PendingAskDock sessionId="sess" requests={[ask('call-1')]} onRespond={onRespond} />);
  fireEvent.click(screen.getByTestId('ask-card'));
  expect(onRespond).toHaveBeenCalledWith('call-1', { type: 'confirm', confirmed: true }, 'call-1');
});

describe('filterDockAskRequests', () => {
  const allow = () => true;
  const deny = () => false;

  test('keeps own-session and descendant capek asks, drops unrelated ones', () => {
    const descendants = new Set(['child-a', 'child-b']);
    const requests = [
      ask('own', { sessionId: 'sess' }),
      ask('from-child', { sessionId: 'sess', originSessionId: 'child-a' }),
      ask('child-direct', { sessionId: 'child-b', originSessionId: undefined }),
      ask('unrelated', { sessionId: 'other', originSessionId: 'other-child' }),
    ];
    const visible = filterDockAskRequests(requests, 'sess', descendants, undefined, deny);
    expect(visible.map((r) => r.toolCallId)).toEqual(['own', 'from-child', 'child-direct']);
  });

  test('native approvals require the matching prefix, session, and controller gate', () => {
    const approval = ask('codex-approval:1', { sessionId: 'sess' });
    expect(filterDockAskRequests([approval], 'sess', new Set(), 'codex-approval:', allow)).toHaveLength(1);
    // Wrong harness prefix: never visible.
    expect(filterDockAskRequests([approval], 'sess', new Set(), 'claude-approval:', allow)).toHaveLength(0);
    // Matching prefix but observer: hidden.
    expect(filterDockAskRequests([approval], 'sess', new Set(), 'codex-approval:', deny)).toHaveLength(0);
    // No prefix configured (capek session): synthetic approval ids stay hidden.
    expect(filterDockAskRequests([approval], 'sess', new Set(), undefined, allow)).toHaveLength(0);
    // Different session view: hidden.
    expect(filterDockAskRequests([approval], 'other', new Set(), 'codex-approval:', allow)).toHaveLength(0);
  });
});
