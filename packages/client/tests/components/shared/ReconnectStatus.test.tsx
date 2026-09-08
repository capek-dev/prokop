import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReconnectStatus } from '@/components/shell/ReconnectStatus';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const props = { authError: null, nextRetryIn: 0, onRetry: vi.fn() };

test('brief disconnections never display status', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1499));
  expect(screen.queryByRole('status')).toBeNull();
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('persistent status is outside layout flow and countdown does not reset delay', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1000));
  view.rerender(<ReconnectStatus {...props} nextRetryIn={2} />);
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 2s...');
  expect(screen.getByRole('status').parentElement).toHaveClass('absolute', 'top-full');
  view.rerender(<ReconnectStatus {...props} />);
  expect(screen.getByRole('status')).toHaveTextContent('Reconnecting...');
});

test('server switch hides previous status and restarts reveal delay', () => {
  const view = render(<ReconnectStatus key="a" {...props} />);
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole('status')).toBeInTheDocument();
  view.rerender(<ReconnectStatus key="b" {...props} />);
  expect(screen.queryByRole('status')).toBeNull();
  act(() => vi.advanceTimersByTime(1499));
  expect(screen.queryByRole('status')).toBeNull();
});

test('recovery removes status and subsequent disconnect has a fresh delay', () => {
  const view = render(<ReconnectStatus {...props} />);
  act(() => vi.advanceTimersByTime(1500));
  view.rerender(<></>);
  view.rerender(<ReconnectStatus {...props} />);
  expect(screen.queryByRole('status')).toBeNull();
});

test('retry remains available after reveal', () => {
  const onRetry = vi.fn();
  render(<ReconnectStatus {...props} onRetry={onRetry} />);
  act(() => vi.advanceTimersByTime(1500));
  fireEvent.click(screen.getByRole('button', { name: 'Retry now' }));
  expect(onRetry).toHaveBeenCalledOnce();
});
