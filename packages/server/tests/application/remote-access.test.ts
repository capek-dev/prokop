import { describe, expect, test } from 'bun:test';
import {
  createRemoteAccessService,
  normalizeAddress,
  type RemoteAccessEnvironment,
} from '@/application/remote-access/service';
import type {
  ListenerControl,
  NetworkInterfaceAddress,
  RemoteAccessNetworkPort,
  TailscaleState,
} from '@/application/ports/remote-access';

const INTERFACES: NetworkInterfaceAddress[] = [
  { interfaceName: 'en0', address: '192.168.1.5', family: 'IPv4' },
  { interfaceName: 'utun4', address: '100.81.2.3', family: 'IPv4' },
  { interfaceName: 'wg0', address: '10.8.0.2', family: 'IPv4' },
  { interfaceName: 'en0', address: '169.254.1.1', family: 'IPv4' },
  { interfaceName: 'en0', address: 'fe80::1', family: 'IPv6' },
];

const TAILSCALE: TailscaleState = { running: true, dnsName: 'studio.tail1234.ts.net', ips: ['100.81.2.3'], serving: false };

function setup(options: {
  environment?: Partial<RemoteAccessEnvironment>;
  tailscale?: TailscaleState | null;
  rebindFails?: boolean;
  serveFails?: string;
} = {}) {
  let stored: unknown = null;
  let host = '127.0.0.1';
  const rebinds: string[] = [];
  const serveCalls: boolean[] = [];
  let changes = 0;
  let networkClosed = 0;
  let tailscale = options.tailscale === undefined ? TAILSCALE : options.tailscale;
  const network: RemoteAccessNetworkPort = {
    interfaces: () => INTERFACES,
    tailscale: async () => tailscale,
    setTailscaleServe: async (enabled) => {
      if (options.serveFails) throw new Error(options.serveFails);
      serveCalls.push(enabled);
      if (tailscale) tailscale = { ...tailscale, serving: enabled };
    },
  };
  const listeners: ListenerControl = {
    endpoint: () => ({ host, port: 8742, protocol: 'http' }),
    loopbackTarget: () => 'http://127.0.0.1:8742',
    rebind: async (next) => {
      if (options.rebindFails) throw new Error('address in use');
      rebinds.push(next);
      host = next;
    },
  };
  const service = createRemoteAccessService({
    repository: { read: () => stored, write: (value) => { stored = JSON.parse(JSON.stringify(value)); } },
    network,
    environment: { bindOverride: null, extraHosts: [], ...options.environment },
    listeners: () => listeners,
    onChanged: () => { changes++; },
    onNetworkListeningDisabled: () => { networkClosed++; },
  });
  return { service, rebinds, serveCalls, stored: () => stored, changes: () => changes, networkClosed: () => networkClosed };
}

describe('normalizeAddress', () => {
  test('keeps origins and picks sensible schemes', () => {
    expect(normalizeAddress('https://Studio.example.com/some/path?q=1', 'http')).toBe('https://studio.example.com');
    expect(normalizeAddress('studio.tail1234.ts.net', 'http')).toBe('https://studio.tail1234.ts.net');
    expect(normalizeAddress('192.168.1.5:8742', 'http')).toBe('http://192.168.1.5:8742');
    expect(normalizeAddress('http://example.com:80', 'http')).toBe('http://example.com');
  });

  test('rejects loopback, other schemes, and garbage', () => {
    expect(() => normalizeAddress('http://localhost:8742', 'http')).toThrow(/Loopback/);
    expect(() => normalizeAddress('ftp://example.com', 'http')).toThrow(/http/);
    expect(() => normalizeAddress('   ', 'http')).toThrow(/Enter an address/);
    expect(() => normalizeAddress('http://exa mple.com', 'http')).toThrow(/not a valid address/);
  });
});

describe('remote access service', () => {
  test('starts on this machine only and suggests network addresses', async () => {
    const { service } = setup();
    expect(service.bindHost()).toBe('127.0.0.1');
    const status = await service.status();
    expect(status.listenOnNetwork).toBe(false);
    expect(status.addresses).toEqual([]);
    expect(status.suggestions).toEqual([
      { url: 'http://studio.tail1234.ts.net:8742', kind: 'tailscale' },
      { url: 'http://192.168.1.5:8742', kind: 'lan' },
      { url: 'http://100.81.2.3:8742', kind: 'tailscale' },
      { url: 'http://10.8.0.2:8742', kind: 'vpn' },
    ]);
    expect(status.tailscale).toMatchObject({ installed: true, running: true, serving: false, url: 'https://studio.tail1234.ts.net' });
    expect(service.pairingBaseUrls()).toEqual([]);
  });

  test('turning network listening on re-binds and offers direct pairing links', async () => {
    const { service, rebinds, changes } = setup();
    const status = await service.setListenOnNetwork(true);
    expect(rebinds).toEqual(['0.0.0.0']);
    expect(status.listenOnNetwork).toBe(true);
    expect(service.bindHost()).toBe('0.0.0.0');
    expect(service.pairingBaseUrls()).toContain('http://192.168.1.5:8742');
    expect(changes()).toBe(1);
  });

  test('turning it off re-binds to loopback and closes network sockets', async () => {
    const { service, rebinds, networkClosed } = setup();
    await service.setListenOnNetwork(true);
    await service.setListenOnNetwork(false);
    expect(rebinds).toEqual(['0.0.0.0', '127.0.0.1']);
    expect(networkClosed()).toBe(1);
  });

  test('a failed re-bind keeps the previous setting', async () => {
    const { service } = setup({ rebindFails: true });
    await expect(service.setListenOnNetwork(true)).rejects.toThrow(/address in use/);
    expect(service.bindHost()).toBe('127.0.0.1');
  });

  test('PROKOPAI_HOST locks the bind address', async () => {
    const { service } = setup({ environment: { bindOverride: '100.81.2.3' } });
    expect(service.bindHost()).toBe('100.81.2.3');
    expect((await service.status()).bindLockedByEnvironment).toBe(true);
    await expect(service.setListenOnNetwork(false)).rejects.toThrow(/PROKOPAI_HOST/);
  });

  test('proxy addresses are known hostnames and pairing links without network listening', async () => {
    const { service, rebinds } = setup();
    const status = await service.addAddress('https://prokop.example.com/');
    expect(status.addresses).toEqual([{ url: 'https://prokop.example.com', source: 'saved', kind: 'proxy' }]);
    expect(rebinds).toEqual([]);
    expect(service.isKnownHostname('PROKOP.example.com')).toBe(true);
    expect(service.isKnownHostname('evil.example.com')).toBe(false);
    expect(service.pairingBaseUrls()).toEqual(['https://prokop.example.com']);

    await service.removeAddress('prokop.example.com');
    expect(service.isKnownHostname('prokop.example.com')).toBe(false);
  });

  test('adding an address that points straight at this machine turns network listening on', async () => {
    const { service, rebinds } = setup();
    const status = await service.addAddress('10.8.0.2:8742');
    expect(rebinds).toEqual(['0.0.0.0']);
    expect(status.addresses).toEqual([{ url: 'http://10.8.0.2:8742', source: 'saved', kind: 'vpn' }]);
    expect(status.suggestions.map((item) => item.url)).not.toContain('http://10.8.0.2:8742');
  });

  test('environment hosts are listed and trusted but not editable', async () => {
    const { service } = setup({ environment: { extraHosts: ['proxy.internal', 'not a host !!'] } });
    const status = await service.status();
    expect(status.addresses).toEqual([{ url: 'https://proxy.internal', source: 'environment', kind: 'proxy' }]);
    expect(service.isKnownHostname('proxy.internal')).toBe(true);
  });

  test('the machine\'s own Tailscale name is trusted once detected', async () => {
    const { service } = setup();
    expect(service.isKnownHostname('studio.tail1234.ts.net')).toBe(false);
    await service.refreshTailscale();
    expect(service.isKnownHostname('studio.tail1234.ts.net')).toBe(true);
  });

  test('Tailscale on shares with tailscale serve and adds the HTTPS address; off removes both', async () => {
    const { service, serveCalls, rebinds } = setup();
    let status = await service.setTailscale(true);
    expect(serveCalls).toEqual([true]);
    expect(rebinds).toEqual([]);
    expect(status.tailscale.serving).toBe(true);
    expect(status.addresses).toEqual([{ url: 'https://studio.tail1234.ts.net', source: 'saved', kind: 'tailscale' }]);
    expect(service.pairingBaseUrls()).toEqual(['https://studio.tail1234.ts.net']);

    status = await service.setTailscale(false);
    expect(serveCalls).toEqual([true, false]);
    expect(status.addresses).toEqual([]);
  });

  test('Tailscale errors explain what to do', async () => {
    await expect(setup({ tailscale: null }).service.setTailscale(true)).rejects.toThrow(/not installed/);
    await expect(setup({ tailscale: { ...TAILSCALE, running: false } }).service.setTailscale(true)).rejects.toThrow(/not connected/);
    await expect(setup({ serveFails: 'Turn on HTTPS for your tailnet at https://login.tailscale.com/f/serve' }).service.setTailscale(true))
      .rejects.toThrow(/login\.tailscale\.com/);
  });

  test('malformed stored settings read as defaults', async () => {
    const { service } = setup();
    expect(service.bindHost()).toBe('127.0.0.1');
    const broken = createRemoteAccessService({
      repository: { read: () => ({ listenOnNetwork: 'yes', addresses: [42, 'https://ok.example.com'] }), write: () => {} },
      network: { interfaces: () => [], tailscale: async () => null, setTailscaleServe: async () => {} },
      environment: { bindOverride: null, extraHosts: [] },
      listeners: () => ({ endpoint: () => ({ host: '127.0.0.1', port: 8742, protocol: 'http' }), loopbackTarget: () => '', rebind: async () => {} }),
    });
    expect(broken.bindHost()).toBe('127.0.0.1');
    expect(broken.pairingBaseUrls()).toEqual(['https://ok.example.com']);
  });
});
