import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AccessDecision, AccessRequestTicket } from '@prokopai/sdk';

const sdk = vi.hoisted(() => ({
  requestDeviceAccess: vi.fn(),
  waitForAccessDecision: vi.fn(),
  redeemPairingCode: vi.fn(),
}));

vi.mock('@prokopai/sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('@prokopai/sdk')>(),
  ...sdk,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

import { PairingError } from '@prokopai/sdk';
import { PairDeviceScreen } from '@/components/PairDeviceScreen';

const server = { name: 'Studio', url: 'http://192.168.1.5:8742' };
const ticket: AccessRequestTicket = { requestId: 'r1', secret: 's1', matchCode: '4821', expiresAt: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  sdk.requestDeviceAccess.mockResolvedValue(ticket);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PairDeviceScreen', () => {
  test('asks for approval immediately and pairs when approved', async () => {
    const decision = deferred<AccessDecision>();
    sdk.waitForAccessDecision.mockReturnValue(decision.promise);
    const onPaired = vi.fn();
    render(<PairDeviceScreen server={server} onPaired={onPaired} />);

    expect(await screen.findByLabelText('Match code 4821')).toBeTruthy();
    expect(sdk.requestDeviceAccess).toHaveBeenCalledWith(server.url, expect.objectContaining({ label: expect.any(String) }));

    decision.resolve({ status: 'approved', token: 'pkd_new', device: {} as never });
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('pkd_new'));
  });

  test('shows a declined request and asks again on demand', async () => {
    sdk.waitForAccessDecision.mockResolvedValueOnce({ status: 'denied' });
    render(<PairDeviceScreen server={server} onPaired={vi.fn()} />);

    expect(await screen.findByText('The request was declined.')).toBeTruthy();
    sdk.waitForAccessDecision.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Ask again' }));
    await waitFor(() => expect(sdk.requestDeviceAccess).toHaveBeenCalledTimes(2));
  });

  test('resumes waiting when the approval stream drops', async () => {
    const onPaired = vi.fn();
    sdk.waitForAccessDecision
      .mockRejectedValueOnce(new PairingError('closed', 0, 'stream_closed'))
      .mockResolvedValueOnce({ status: 'approved', token: 'pkd_late', device: {} as never });
    render(<PairDeviceScreen server={server} onPaired={onPaired} />);

    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('pkd_late'), { timeout: 3000 });
    expect(sdk.requestDeviceAccess).toHaveBeenCalledTimes(1);
  });

  test('inside another machine\'s app it switches to a pairing code', async () => {
    sdk.requestDeviceAccess.mockRejectedValueOnce(new PairingError('Requests from other websites are not allowed.', 403, 'foreign-origin'));
    render(<PairDeviceScreen server={server} onPaired={vi.fn()} />);

    expect(await screen.findByLabelText('Pairing code')).toBeTruthy();
    expect(screen.getByText(/Enter a pairing code from that machine/)).toBeTruthy();
    expect(sdk.waitForAccessDecision).not.toHaveBeenCalled();
  });

  test('pairs with a code instead', async () => {
    sdk.waitForAccessDecision.mockReturnValue(new Promise(() => {}));
    sdk.redeemPairingCode
      .mockRejectedValueOnce(new PairingError('This pairing code is invalid, expired, or already used.', 400, 'invalid_code'))
      .mockResolvedValueOnce({ token: 'pkd_code', device: {} as never });
    const onPaired = vi.fn();
    render(<PairDeviceScreen server={server} onPaired={onPaired} />);

    fireEvent.click(screen.getByRole('button', { name: 'Use a pairing code instead' }));
    fireEvent.change(screen.getByLabelText('Pairing code'), { target: { value: 'abcd-efgh-2345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    expect(await screen.findByText('This pairing code is invalid, expired, or already used.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
    await waitFor(() => expect(onPaired).toHaveBeenCalledWith('pkd_code'));
    expect(sdk.redeemPairingCode).toHaveBeenLastCalledWith(server.url, expect.objectContaining({ code: 'abcd-efgh-2345' }));
  });
});
