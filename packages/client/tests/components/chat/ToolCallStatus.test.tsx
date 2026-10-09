import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ToolPart, ToolState } from '@prokopai/sdk';
import { ToolCall } from '@/components/chat/ToolCall';
import { ServerClientProvider } from '@/contexts/ServerClientContext';

vi.mock('@/hooks/queries', () => ({
  useToolDisplayCatalog: () => ({}),
  useToolDebugQuery: () => ({}),
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

function view(id: string, state: ToolState) {
  const part: ToolPart = { id, messageId: 'm', createdAt: 1, type: 'tool', callId: id, name: 'bash', state };
  return (
    <ServerClientProvider value={{ sdkClient: null, serverUrl: 'https://status.test', apiToken: null, connected: false }}>
      <ToolCall sessionId="status-session" part={part} />
    </ServerClientProvider>
  );
}

test('finished tools show their duration', () => {
  render(view('done', { status: 'completed', input: {}, output: null, startedAt: 1_000, completedAt: 2_400 }));
  expect(screen.getByText('1.4s')).toBeInTheDocument();
});

test('a failed tool shows its first error line without expanding', () => {
  render(view('failed', { status: 'error', input: {}, error: '\nENOENT: missing.txt\n  at read', startedAt: 1, failedAt: 2 }));
  expect(screen.getByText('ENOENT: missing.txt')).toBeInTheDocument();
  expect(screen.queryByText(/at read/)).not.toBeInTheDocument();
});

test('an interrupted tool names the reason', () => {
  render(view('cut', { status: 'interrupted', input: {}, startedAt: 1, interruptedAt: 2, reason: 'timeout' }));
  expect(screen.getByText('timed out')).toBeInTheDocument();
});

test('a running tool counts up live', () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  render(view('live', { status: 'running', input: {}, startedAt: 5_000 }));
  expect(screen.getByText('5s')).toBeInTheDocument();

  act(() => { vi.advanceTimersByTime(2_000); });
  expect(screen.getByText('7s')).toBeInTheDocument();
});
