// CLI: pair another device and manage paired devices through the running server
import { renderUnicodeCompact } from 'uqr';
import { getClientUrl } from '@/cli/open-client';
import { getStatus } from '@/infrastructure/daemon';

async function localServerRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const baseUrl = getClientUrl();
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    // Loopback only: a Tailscale or custom certificate never names localhost.
    ...(baseUrl.startsWith('https://') ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

function requireRunningServer(): boolean {
  if (!getStatus().running) {
    console.error('Prokop is not running. Start it with: prokop start');
    return false;
  }
  return true;
}

async function errorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as { message?: string };
  return body.message ?? `HTTP ${response.status}`;
}

export async function runPairCommand(): Promise<number> {
  if (!requireRunningServer()) return 1;

  const response = await localServerRequest('/api/auth/pairing-codes', { method: 'POST', body: '{}' });
  if (!response.ok) {
    console.error(`Could not create a pairing code: ${await errorMessage(response)}`);
    return 1;
  }
  const { code, expiresAt, links } = await response.json() as { code: string; expiresAt: number; links: string[] };
  if (links.length === 0) {
    console.error('Other devices cannot reach Prokop yet. Turn on remote access first:');
    console.error('  prokop remote on              # listen on your network or VPN');
    console.error('  prokop remote tailscale on    # or share over Tailscale HTTPS');
    console.error('  prokop remote add <url>       # or use your own proxy or tunnel address');
    return 1;
  }
  const minutes = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));

  console.log('\nScan with your phone, or open the link on the other device:\n');
  console.log(renderUnicodeCompact(links[0]!, { border: 2 }));
  console.log(`\n  ${links[0]}`);
  for (const url of links.slice(1)) console.log(`  ${url}`);
  console.log(`\nOr enter this code in Add server: ${code}`);
  console.log(`The code works once and expires in ${minutes} minute${minutes === 1 ? '' : 's'}.\n`);
  return 0;
}

interface RemoteAccessStatusBody {
  listenOnNetwork: boolean;
  bindHost: string;
  bindLockedByEnvironment: boolean;
  endpoint: { protocol: string; port: number };
  addresses: Array<{ url: string; source: string; kind: string }>;
  suggestions: Array<{ url: string; kind: string }>;
  tailscale: { installed: boolean; running: boolean; serving: boolean; url: string | null };
}

function printRemoteStatus(status: RemoteAccessStatusBody): void {
  console.log(`\nListening: ${status.listenOnNetwork ? `on your network (${status.bindHost})` : 'only on this computer'}`
    + (status.bindLockedByEnvironment ? ' [set by PROKOPAI_HOST]' : ''));
  if (status.addresses.length > 0) {
    console.log('\nAddresses other devices use:');
    for (const address of status.addresses) {
      console.log(`  ${address.url}  (${address.kind}${address.source === 'environment' ? ', PROKOPAI_ALLOWED_HOSTS' : ''})`);
    }
  }
  if (status.suggestions.length > 0) {
    console.log(status.listenOnNetwork ? '\nAlso reachable at:' : '\nAvailable after `prokop remote on`:');
    for (const suggestion of status.suggestions) console.log(`  ${suggestion.url}  (${suggestion.kind})`);
  }
  if (status.tailscale.installed) {
    const state = !status.tailscale.running ? 'installed, not connected'
      : status.tailscale.serving ? `sharing at ${status.tailscale.url}` : 'connected (run `prokop remote tailscale on` for HTTPS)';
    console.log(`\nTailscale: ${state}`);
  }
  console.log('');
}

const REMOTE_USAGE = 'Usage: prokop remote [on | off | add <url> | remove <url> | tailscale on|off]';

export async function runRemoteCommand(args: string[]): Promise<number> {
  if (!requireRunningServer()) return 1;
  const [action, value] = args;
  let response: Response;
  switch (action) {
    case undefined:
    case 'status':
      response = await localServerRequest('/api/remote-access');
      break;
    case 'on':
    case 'off':
      response = await localServerRequest('/api/remote-access', {
        method: 'PUT',
        body: JSON.stringify({ listenOnNetwork: action === 'on' }),
      });
      break;
    case 'add':
    case 'remove':
      if (!value) {
        console.error(REMOTE_USAGE);
        return 1;
      }
      response = action === 'add'
        ? await localServerRequest('/api/remote-access/addresses', { method: 'POST', body: JSON.stringify({ url: value }) })
        : await localServerRequest(`/api/remote-access/addresses?url=${encodeURIComponent(value)}`, { method: 'DELETE' });
      break;
    case 'tailscale':
      if (value !== 'on' && value !== 'off') {
        console.error(REMOTE_USAGE);
        return 1;
      }
      response = await localServerRequest('/api/remote-access/tailscale', {
        method: 'POST',
        body: JSON.stringify({ enabled: value === 'on' }),
      });
      break;
    default:
      console.error(REMOTE_USAGE);
      return 1;
  }
  if (!response.ok) {
    console.error(await errorMessage(response));
    return 1;
  }
  printRemoteStatus(await response.json() as RemoteAccessStatusBody);
  if (action === 'on' || action === 'tailscale' || action === 'add') {
    console.log('Pair a device with: prokop pair\n');
  }
  return 0;
}

interface DeviceListEntry {
  id: string;
  label: string;
  deviceKind: string;
  lastSeenAt: number;
}

export async function runAuthCommand(subcommand: string | undefined, argument: string | undefined): Promise<number> {
  if (subcommand === 'revoke') {
    if (!argument) {
      console.error('Usage: prokop auth revoke <device-id>');
      return 1;
    }
    if (!requireRunningServer()) return 1;
    const response = await localServerRequest(`/api/auth/devices/${encodeURIComponent(argument)}`, { method: 'DELETE' });
    if (!response.ok) {
      console.error(response.status === 404 ? `No paired device with id ${argument}.` : `Revoke failed (HTTP ${response.status}).`);
      return 1;
    }
    console.log(`Revoked ${argument}. Its open connections were closed.`);
    return 0;
  }

  console.log('\nThis machine never needs a login. Other devices must be paired: run prokop pair.');
  if (!getStatus().running) {
    console.log('Start Prokop (prokop start) to list paired devices.\n');
    return 0;
  }
  const response = await localServerRequest('/api/auth/access');
  if (!response.ok) {
    console.error(`Could not list devices (HTTP ${response.status}).`);
    return 1;
  }
  const { devices } = await response.json() as { devices: DeviceListEntry[] };
  if (devices.length === 0) {
    console.log('No paired devices.\n');
    return 0;
  }
  console.log('\nPaired devices:');
  for (const device of devices) {
    console.log(`  ${device.id}  ${device.label} (${device.deviceKind}), last seen ${new Date(device.lastSeenAt).toLocaleString()}`);
  }
  console.log('\nRevoke one with: prokop auth revoke <device-id>\n');
  return 0;
}
