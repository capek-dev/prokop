import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { UsagePanel, formatResetIn } from '@/components/modals/configuration/UsagePanel';

const sessions = { harnesses: vi.fn(), harnessUsage: vi.fn() };
const client = { http: { sessions } } as unknown as ProkopaiClient;

beforeEach(() => {
  sessions.harnesses.mockReset().mockResolvedValue({ harnesses: [
    { id: 'prokop', available: true, enabled: true },
    { id: 'claude-cli', available: true, enabled: true },
    { id: 'codex-cli', available: false, enabled: true },
  ] });
  sessions.harnessUsage.mockReset().mockResolvedValue({ usage: {
    harness: 'claude-cli', checkedAt: new Date().toISOString(), plan: 'pro', windows: [
      { id: 'five_hour', kind: 'session', label: '5-hour', usedPercent: 18.4 },
      { id: 'seven_day', kind: 'weekly', label: 'Weekly', usedPercent: 95 },
    ],
  } });
});

function setup() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}><UsagePanel sdkClient={client} /></QueryClientProvider>);
}

test('shows windows for installed harnesses and never reads Prokop or missing CLIs', async () => {
  setup();
  expect(await screen.findByText('18% used')).toBeInTheDocument();
  expect(screen.getByText('95% used')).toBeInTheDocument();
  expect(screen.getByText('pro')).toBeInTheDocument();
  expect(screen.getByText('Install the CLI on this host to see its usage.')).toBeInTheDocument();
  expect(screen.queryByText('Prokop')).not.toBeInTheDocument();
  expect(sessions.harnessUsage).toHaveBeenCalledTimes(1);
  expect(sessions.harnessUsage).toHaveBeenCalledWith('claude-cli');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Claude CLI usage' }));
  await waitFor(() => expect(sessions.harnessUsage).toHaveBeenCalledTimes(2));
});

test('unsupported accounts show the server message instead of bars', async () => {
  sessions.harnessUsage.mockResolvedValue({ usage: { harness: 'claude-cli', checkedAt: '', plan: null, windows: [],
    unavailable: { reason: 'unsupported', message: 'Plan limits apply only to Claude subscription logins.' } } });
  setup();
  expect(await screen.findByText('Plan limits apply only to Claude subscription logins.')).toBeInTheDocument();
});

test('reset times read as coarse remaining durations', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  expect(formatResetIn('2026-10-03T12:12:00Z', now)).toBe('12m');
  expect(formatResetIn('2026-10-03T15:20:00Z', now)).toBe('3h 20m');
  expect(formatResetIn('2026-10-08T16:00:00Z', now)).toBe('5d 4h');
  expect(formatResetIn('2026-10-01T00:00:00Z', now)).toBe('0m');
});
