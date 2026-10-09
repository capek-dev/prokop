import { describe, expect, test } from 'bun:test';
import { parseServeStatus, parseStatus } from '@/infrastructure/network/remote-access-network';

describe('tailscale CLI parsing', () => {
  test('reads the MagicDNS name, IPs, and connection state', () => {
    expect(parseStatus(JSON.stringify({
      BackendState: 'Running',
      TailscaleIPs: ['100.81.2.3'],
      Self: { DNSName: 'Studio.tail1234.ts.net.' },
    }))).toEqual({ running: true, dnsName: 'studio.tail1234.ts.net', ips: ['100.81.2.3'] });
    expect(parseStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: {} }))).toEqual({ running: false, dnsName: null, ips: [] });
  });

  test('recognizes serve config that forwards HTTPS 443 to this server', () => {
    const serving = JSON.stringify({
      TCP: { 443: { HTTPS: true } },
      Web: { 'studio.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:8742' } } } },
    });
    expect(parseServeStatus(serving, 'http://127.0.0.1:8742')).toBe(true);
    expect(parseServeStatus(serving.replace('127.0.0.1', 'localhost'), 'http://127.0.0.1:8742')).toBe(true);
    expect(parseServeStatus(serving, 'http://127.0.0.1:9999')).toBe(false);
    expect(parseServeStatus('{}', 'http://127.0.0.1:8742')).toBe(false);
    expect(parseServeStatus('not json', 'http://127.0.0.1:8742')).toBe(false);
  });
});
