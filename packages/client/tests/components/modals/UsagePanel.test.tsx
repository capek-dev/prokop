import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProkopaiClient } from '@prokopai/sdk';
import { UsagePanel, formatResetIn } from '@/components/modals/configuration/UsagePanel';

const sessions = { harnesses: vi.fn(), harnessUsage: vi.fn() };
const providers = { listCredentials: vi.fn(), usage: vi.fn(), list: vi.fn(), codexAccountUsage: vi.fn() };
const client = { http: { sessions, providers } } as unknown as ProkopaiClient;

beforeEach(() => {
  providers.listCredentials.mockReset().mockResolvedValue({ providers: [] });
  providers.usage.mockReset();
  providers.list.mockReset().mockResolvedValue({ providers: [] });
  providers.codexAccountUsage.mockReset();
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

test('configured providers show balances and quotas without probing unconfigured providers or Codex', async () => {
  providers.listCredentials.mockResolvedValue({ providers: [
    { provider: 'deepseek', configured: true },
    { provider: 'zhipu-coding', configured: true },
    { provider: 'minimax', configured: false },
    { provider: 'codex', configured: true },
  ] });
  providers.usage.mockImplementation(async provider => ({ usage: {
    provider, checkedAt: '', plan: null,
    balances: provider === 'deepseek' ? [{ currency: 'USD', remaining: '0.00', granted: '0', toppedUp: '0' }] : [],
    windows: provider === 'zhipu-coding' ? [{ id: 'quota', label: '5-hour', usedPercent: 42 }] : [],
  } }));
  setup();
  expect(await screen.findByText('0.00 USD remaining')).toBeInTheDocument();
  expect(await screen.findByText('42% used')).toBeInTheDocument();
  expect(screen.getByText('Z.AI Coding Plan')).toBeInTheDocument();
  expect(screen.queryByText('MiniMax')).not.toBeInTheDocument();
  expect(providers.usage.mock.calls.map(call => call[0])).toEqual(['deepseek', 'zhipu-coding']);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh DeepSeek usage' }));
  await waitFor(() => expect(providers.usage).toHaveBeenCalledTimes(3));
});

test('unavailable provider quota shows a message, not a zero bar', async () => {
  providers.listCredentials.mockResolvedValue({ providers: [{ provider: 'minimax', configured: true }] });
  providers.usage.mockResolvedValue({ usage: { provider: 'minimax', plan: null, balances: [], windows: [],
    unavailable: { reason: 'probeFailed', message: 'API key cannot read plan usage.' } } });
  setup();
  expect(await screen.findByText('API key cannot read plan usage.')).toBeInTheDocument();
  expect(screen.queryByText('0% used')).not.toBeInTheDocument();
});

test('MiniMax unlimited weekly quota has no percentage bar', async () => {
  sessions.harnesses.mockResolvedValue({ harnesses: [] });
  providers.listCredentials.mockResolvedValue({ providers: [{ provider: 'minimax', configured: true }] });
  providers.usage.mockResolvedValue({ usage: { provider: 'minimax', plan: null, balances: [], windows: [
    { id: 'general-interval', label: '5-hour', usedPercent: 0 },
    { id: 'general-weekly', label: 'Weekly', unlimited: true },
  ] } });
  setup();
  expect(await screen.findByText('Unlimited')).toBeInTheDocument();
  expect(screen.getByText('Weekly')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: '5-hour usage' })).toBeInTheDocument();
  expect(screen.queryByRole('progressbar', { name: 'Weekly usage' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('progressbar')).toHaveLength(1);
});

test('shows every stored Codex account independently, even with no active account', async () => {
  providers.list.mockResolvedValue({ providers: [{ provider: 'codex', connected: false, activeAccountId: null, accounts: [
    { id: 'a', label: 'Personal', connectionId: 'a1', reauthRequired: false },
    { id: 'b', label: 'Work', connectionId: 'b1', reauthRequired: false },
    { id: 'c', label: 'Expired', connectionId: 'c1', reauthRequired: true },
  ] }] });
  providers.codexAccountUsage.mockImplementation(async id => {
    if (id === 'b') throw new Error('unavailable');
    return { usage: { accountId: id, plan: 'plus', windows: [{ id: 'primary', label: '5-hour', usedPercent: 37 }] } };
  });
  setup();
  const personal = await screen.findByRole('region', { name: 'Codex · Personal' });
  expect(await within(personal).findByText('37% used')).toBeInTheDocument();
  const work = screen.getByRole('region', { name: 'Codex · Work' });
  expect(await within(work).findByText('Could not read usage for this Codex account.')).toBeInTheDocument();
  expect(screen.getByText('Reconnect this Codex account in LLM providers.')).toBeInTheDocument();
  expect(screen.getByText('Codex CLI')).toBeInTheDocument();
  expect(providers.codexAccountUsage.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
  expect(providers.codexAccountUsage.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  fireEvent.click(within(personal).getByRole('button', { name: 'Refresh Codex Personal usage' }));
  await waitFor(() => expect(providers.codexAccountUsage).toHaveBeenCalledTimes(3));
});

test('reset times read as coarse remaining durations', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');
  expect(formatResetIn('2026-10-03T12:12:00Z', now)).toBe('12m');
  expect(formatResetIn('2026-10-03T15:20:00Z', now)).toBe('3h 20m');
  expect(formatResetIn('2026-10-08T16:00:00Z', now)).toBe('5d 4h');
  expect(formatResetIn('2026-10-01T00:00:00Z', now)).toBe('0m');
});
