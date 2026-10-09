import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ProkopaiClient, RemoteAccessStatus } from '@prokopai/sdk';
import { RemoteAccessSection } from '@/components/modals/configuration/RemoteAccessSection';

const base: RemoteAccessStatus = {
  listenOnNetwork: false,
  bindHost: '127.0.0.1',
  bindLockedByEnvironment: false,
  endpoint: { protocol: 'http', port: 8742 },
  addresses: [],
  suggestions: [{ url: 'http://192.168.1.5:8742', kind: 'lan' }],
  tailscale: { installed: true, running: true, dnsName: 'studio.ts.net', serving: false, url: 'https://studio.ts.net' },
};

function fakeClient(initial: RemoteAccessStatus) {
  const remoteAccess = {
    status: vi.fn().mockResolvedValue(initial),
    setListenOnNetwork: vi.fn(async (on: boolean) => ({ ...initial, listenOnNetwork: on, bindHost: on ? '0.0.0.0' : '127.0.0.1' })),
    addAddress: vi.fn(async (url: string) => ({ ...initial, addresses: [{ url, source: 'saved', kind: 'proxy' }] })),
    removeAddress: vi.fn(async () => initial),
    setTailscale: vi.fn(async (enabled: boolean) => ({
      ...initial,
      tailscale: { ...initial.tailscale, serving: enabled },
      addresses: enabled ? [{ url: 'https://studio.ts.net', source: 'saved', kind: 'tailscale' }] : [],
    })),
  };
  const client = { http: { remoteAccess }, on: vi.fn(), off: vi.fn() } as unknown as ProkopaiClient;
  return { client, remoteAccess };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RemoteAccessSection', () => {
  test('turns network listening on and shows where devices can reach it', async () => {
    const { client, remoteAccess } = fakeClient(base);
    render(<RemoteAccessSection sdkClient={client} />);

    const toggle = await screen.findByRole('switch', { name: 'Allow devices on my network' });
    expect(screen.queryByText('http://192.168.1.5:8742')).toBeNull();
    fireEvent.click(toggle);

    await waitFor(() => expect(remoteAccess.setListenOnNetwork).toHaveBeenCalledWith(true));
    expect(await screen.findByText('http://192.168.1.5:8742')).toBeTruthy();
  });

  test('sets up Tailscale HTTPS in one click', async () => {
    const { client, remoteAccess } = fakeClient(base);
    render(<RemoteAccessSection sdkClient={client} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }));
    await waitFor(() => expect(remoteAccess.setTailscale).toHaveBeenCalledWith(true));
    expect(await screen.findByText('Shared at https://studio.ts.net')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  test('adds a proxy or VPN address', async () => {
    const { client, remoteAccess } = fakeClient(base);
    render(<RemoteAccessSection sdkClient={client} />);

    fireEvent.change(await screen.findByLabelText('Address other devices use'), { target: { value: 'https://prokop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(remoteAccess.addAddress).toHaveBeenCalledWith('https://prokop.example.com'));
    expect(await screen.findByText('https://prokop.example.com')).toBeTruthy();
    expect((screen.getByLabelText('Address other devices use') as HTMLInputElement).value).toBe('');
  });

  test('explains a toggle locked by PROKOPAI_HOST and shows server errors', async () => {
    const { client, remoteAccess } = fakeClient({ ...base, bindLockedByEnvironment: true, bindHost: '100.81.2.3', listenOnNetwork: true });
    remoteAccess.addAddress.mockRejectedValueOnce(new Error('Loopback addresses only reach the device that opens them.'));
    render(<RemoteAccessSection sdkClient={client} />);

    expect(await screen.findByText('Set by PROKOPAI_HOST (100.81.2.3).')).toBeTruthy();
    expect((screen.getByRole('switch', { name: 'Allow devices on my network' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Address other devices use'), { target: { value: 'localhost' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('Loopback addresses only reach the device that opens them.')).toBeTruthy();
  });

  test('hides Tailscale when it is not installed', async () => {
    const { client } = fakeClient({ ...base, tailscale: { ...base.tailscale, installed: false } });
    render(<RemoteAccessSection sdkClient={client} />);
    await screen.findByRole('switch', { name: 'Allow devices on my network' });
    expect(screen.queryByText('Tailscale HTTPS')).toBeNull();
  });
});
