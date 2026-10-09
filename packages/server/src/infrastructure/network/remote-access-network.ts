// Network interfaces and the Tailscale CLI for remote-access settings
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import type {
  NetworkInterfaceAddress,
  RemoteAccessNetworkPort,
  TailscaleState,
} from '@/application/ports/remote-access';

const TAILSCALE_TIMEOUT_MS = 20_000;
const TAILSCALE_APP_PATHS = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe',
];

export function findTailscaleBinary(): string | null {
  return Bun.which('tailscale') ?? TAILSCALE_APP_PATHS.find((path) => existsSync(path)) ?? null;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function run(binary: string, args: string[]): Promise<CommandResult> {
  const child = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', windowsHide: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, TAILSCALE_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function sameTarget(proxy: string, target: string): boolean {
  const normalize = (value: string) => value.replace(/\/+$/, '').replace('://localhost:', '://127.0.0.1:');
  return normalize(proxy) === normalize(target);
}

/** True when `tailscale serve status --json` forwards HTTPS 443 `/` to the target. */
export function parseServeStatus(json: string, target: string): boolean {
  try {
    const status = JSON.parse(json) as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };
    return Object.entries(status.Web ?? {}).some(([hostPort, web]) =>
      hostPort.endsWith(':443') && typeof web.Handlers?.['/']?.Proxy === 'string' && sameTarget(web.Handlers['/'].Proxy, target));
  } catch {
    return false;
  }
}

export function parseStatus(json: string): Omit<TailscaleState, 'serving'> {
  const status = JSON.parse(json) as {
    BackendState?: string;
    TailscaleIPs?: string[];
    Self?: { DNSName?: string; TailscaleIPs?: string[] };
  };
  const dnsName = status.Self?.DNSName?.replace(/\.$/, '').toLowerCase() || null;
  return {
    running: status.BackendState === 'Running',
    dnsName,
    ips: status.Self?.TailscaleIPs ?? status.TailscaleIPs ?? [],
  };
}

/** Tailscale prints an admin URL when HTTPS or Serve is not enabled for the tailnet. */
function explainFailure(result: CommandResult): string {
  const output = `${result.stdout}\n${result.stderr}`;
  const link = /https:\/\/login\.tailscale\.com\/\S+/.exec(output)?.[0];
  if (link) return `Turn on HTTPS for your tailnet at ${link}, then try again.`;
  if (result.timedOut) return 'the Tailscale command did not finish.';
  return output.trim().split('\n').at(-1) || `tailscale exited with code ${result.exitCode}`;
}

export function createRemoteAccessNetwork(): RemoteAccessNetworkPort {
  return {
    interfaces(): NetworkInterfaceAddress[] {
      return Object.entries(networkInterfaces()).flatMap(([interfaceName, entries]) =>
        (entries ?? [])
          .filter((entry) => !entry.internal)
          .map((entry) => ({
            interfaceName,
            address: entry.address,
            family: entry.family === 'IPv6' ? 'IPv6' as const : 'IPv4' as const,
          })));
    },

    async tailscale(loopbackTarget) {
      const binary = findTailscaleBinary();
      if (!binary) return null;
      const status = await run(binary, ['status', '--json']);
      if (status.exitCode !== 0) return { running: false, dnsName: null, ips: [], serving: false };
      let parsed: Omit<TailscaleState, 'serving'>;
      try {
        parsed = parseStatus(status.stdout);
      } catch {
        return { running: false, dnsName: null, ips: [], serving: false };
      }
      const serve = parsed.running ? await run(binary, ['serve', 'status', '--json']) : null;
      return { ...parsed, serving: serve?.exitCode === 0 && parseServeStatus(serve.stdout, loopbackTarget) };
    },

    async setTailscaleServe(enabled, loopbackTarget) {
      const binary = findTailscaleBinary();
      if (!binary) throw new Error('Tailscale is not installed.');
      const args = enabled
        ? ['serve', '--bg', '--yes', '--https=443', loopbackTarget]
        : ['serve', '--https=443', 'off'];
      const result = await run(binary, args);
      if (result.exitCode !== 0 || result.timedOut) throw new Error(explainFailure(result));
    },
  };
}
