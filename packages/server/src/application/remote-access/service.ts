import { BadRequestError, ConflictError, HttpError } from '@/application/http-errors';
import type {
  ListenerControl,
  NetworkInterfaceAddress,
  RemoteAccessNetworkPort,
  RemoteAccessSettings,
  RemoteAccessSettingsRepository,
  TailscaleState,
} from '@/application/ports/remote-access';

export type RemoteAccessKind = 'lan' | 'tailscale' | 'vpn' | 'proxy';

export interface RemoteAccessAddress {
  url: string;
  source: 'saved' | 'environment';
  kind: RemoteAccessKind;
}

export interface RemoteAccessSuggestion {
  url: string;
  kind: Exclude<RemoteAccessKind, 'proxy'>;
}

export interface RemoteAccessStatus {
  listenOnNetwork: boolean;
  bindHost: string;
  /** PROKOPAI_HOST or --host decides the bind; the toggle is read-only. */
  bindLockedByEnvironment: boolean;
  endpoint: { protocol: 'http' | 'https'; port: number };
  addresses: RemoteAccessAddress[];
  suggestions: RemoteAccessSuggestion[];
  tailscale: {
    installed: boolean;
    running: boolean;
    dnsName: string | null;
    /** `tailscale serve` forwards to this server. */
    serving: boolean;
    /** The HTTPS address `tailscale serve` provides. */
    url: string | null;
  };
}

export interface RemoteAccessEnvironment {
  /** PROKOPAI_HOST or --host; null when the setting decides. */
  bindOverride: string | null;
  /** PROKOPAI_ALLOWED_HOSTS entries (hostnames or URLs). */
  extraHosts: string[];
}

export interface RemoteAccessOptions {
  repository: RemoteAccessSettingsRepository;
  network: RemoteAccessNetworkPort;
  environment: RemoteAccessEnvironment;
  /** Late-bound: listeners start after the application is composed. */
  listeners: () => ListenerControl;
  /** Settings or derived status changed (broadcast to clients). */
  onChanged?: () => void;
  /** Network listening turned off: connections that arrived over the network must close. */
  onNetworkListeningDisabled?: () => void;
}

export interface RemoteAccessService {
  /** Host the main listener binds at startup. */
  bindHost(): string;
  /** Hostnames another device may use through a same-machine proxy (DNS-rebinding allowlist). */
  isKnownHostname(hostname: string): boolean;
  /** Base URLs for pairing links: saved addresses, then detected ones when listening on the network. */
  pairingBaseUrls(): string[];
  status(): Promise<RemoteAccessStatus>;
  setListenOnNetwork(enabled: boolean): Promise<RemoteAccessStatus>;
  addAddress(input: string): Promise<RemoteAccessStatus>;
  removeAddress(input: string): Promise<RemoteAccessStatus>;
  setTailscale(enabled: boolean): Promise<RemoteAccessStatus>;
  /** Refreshes the cached Tailscale name used by the allowlist. */
  refreshTailscale(): Promise<void>;
}

const MAX_ADDRESSES = 20;
const LOOPBACK_BIND = '127.0.0.1';
const NETWORK_BIND = '0.0.0.0';
const VPN_INTERFACE = /^(utun|wg|tun|tap|zt|ppp|ipsec|nordlynx|proton)/i;

function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return bare === 'localhost' || bare.endsWith('.localhost') || bare === '::1' || /^127\./.test(bare);
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

function isWildcardOrNetwork(host: string): boolean {
  return !isLoopbackHostname(host);
}

function isTailscaleIp(address: string): boolean {
  const match = /^100\.(\d{1,3})\./.exec(address);
  return match !== null && Number(match[1]) >= 64 && Number(match[1]) <= 127;
}

function classifyInterface(entry: NetworkInterfaceAddress): RemoteAccessSuggestion['kind'] {
  if (isTailscaleIp(entry.address)) return 'tailscale';
  return VPN_INTERFACE.test(entry.interfaceName) ? 'vpn' : 'lan';
}

/**
 * Normalizes user input to an origin. Bare hostnames default to HTTPS; bare
 * IP addresses default to the listener's own protocol.
 */
export function normalizeAddress(input: string, defaultIpProtocol: 'http' | 'https'): string {
  const trimmed = input.trim();
  if (!trimmed) throw new BadRequestError('Enter an address.');
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (!hasScheme && isIpLiteral(url.hostname.replace(/^\[|\]$/g, ''))) {
      url = new URL(`${defaultIpProtocol}://${trimmed}`);
    }
  } catch {
    throw new BadRequestError(`"${trimmed}" is not a valid address.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestError('Addresses must start with http:// or https://.');
  }
  if (isLoopbackHostname(url.hostname)) {
    throw new BadRequestError('Loopback addresses only reach the device that opens them.');
  }
  return url.origin;
}

function parseSettings(raw: unknown): RemoteAccessSettings {
  const value = (raw ?? {}) as Partial<Record<keyof RemoteAccessSettings, unknown>>;
  const addresses = Array.isArray(value.addresses)
    ? value.addresses.filter((item): item is string => typeof item === 'string')
    : [];
  return { listenOnNetwork: value.listenOnNetwork === true, addresses };
}

function hostnameOf(origin: string): string {
  return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function portOf(origin: string): number {
  const url = new URL(origin);
  return url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
}

export function createRemoteAccessService(options: RemoteAccessOptions): RemoteAccessService {
  const { repository, network, environment, listeners } = options;
  let tailscaleCache: TailscaleState | null = null;
  let tailscaleInstalled = false;

  const read = (): RemoteAccessSettings => parseSettings(repository.read());

  const environmentAddresses = (): string[] => environment.extraHosts.flatMap((entry) => {
    try {
      return [normalizeAddress(entry, 'https')];
    } catch {
      return [];
    }
  });

  const bindHost = (): string => environment.bindOverride
    ?? (read().listenOnNetwork ? NETWORK_BIND : LOOPBACK_BIND);

  const localAddresses = (): NetworkInterfaceAddress[] => network.interfaces()
    .filter((entry) => entry.family === 'IPv4' && !entry.address.startsWith('169.254.') && !entry.address.startsWith('127.'));

  /** Points straight at this server's listener (needs network listening), as opposed to a proxy. */
  const isDirect = (origin: string): boolean => {
    const endpoint = listeners().endpoint();
    if (portOf(origin) !== endpoint.port) return false;
    const hostname = hostnameOf(origin);
    if (localAddresses().some((entry) => entry.address === hostname)) return true;
    return tailscaleCache !== null && (tailscaleCache.dnsName === hostname || tailscaleCache.ips.includes(hostname));
  };

  const kindOf = (origin: string): RemoteAccessKind => {
    const hostname = hostnameOf(origin);
    if (tailscaleCache?.dnsName === hostname || isTailscaleIp(hostname) || hostname.endsWith('.ts.net')) return 'tailscale';
    if (!isDirect(origin)) return 'proxy';
    const entry = localAddresses().find((item) => item.address === hostname);
    return entry ? classifyInterface(entry) : 'lan';
  };

  const suggestions = (saved: Set<string>): RemoteAccessSuggestion[] => {
    const { protocol, port } = listeners().endpoint();
    const found: RemoteAccessSuggestion[] = localAddresses()
      .map((entry) => ({ url: `${protocol}://${entry.address}:${port}`, kind: classifyInterface(entry) }));
    if (tailscaleCache?.running && tailscaleCache.dnsName) {
      found.unshift({ url: `${protocol}://${tailscaleCache.dnsName}:${port}`, kind: 'tailscale' });
    }
    const unique = new Map(found.map((item) => [new URL(item.url).origin, { ...item, url: new URL(item.url).origin }]));
    return Array.from(unique.values()).filter((item) => !saved.has(item.url));
  };

  const loadTailscale = async (): Promise<TailscaleState | null> => {
    const state = await network.tailscale(listeners().loopbackTarget());
    tailscaleInstalled = state !== null;
    tailscaleCache = state;
    return state;
  };

  const save = (settings: RemoteAccessSettings): void => {
    repository.write({ listenOnNetwork: settings.listenOnNetwork, addresses: Array.from(new Set(settings.addresses)) });
  };

  const buildStatus = (): RemoteAccessStatus => {
    const settings = read();
    const host = bindHost();
    const endpoint = listeners().endpoint();
    const saved = settings.addresses.map((url) => ({ url, source: 'saved' as const, kind: kindOf(url) }));
    const fromEnvironment = environmentAddresses()
      .filter((url) => !settings.addresses.includes(url))
      .map((url) => ({ url, source: 'environment' as const, kind: kindOf(url) }));
    const addresses = [...saved, ...fromEnvironment];
    const tailscaleUrl = tailscaleCache?.dnsName ? `https://${tailscaleCache.dnsName}` : null;
    return {
      listenOnNetwork: isWildcardOrNetwork(host),
      bindHost: host,
      bindLockedByEnvironment: environment.bindOverride !== null,
      endpoint: { protocol: endpoint.protocol, port: endpoint.port },
      addresses,
      suggestions: suggestions(new Set(addresses.map((item) => item.url))),
      tailscale: {
        installed: tailscaleInstalled,
        running: tailscaleCache?.running ?? false,
        dnsName: tailscaleCache?.dnsName ?? null,
        serving: tailscaleCache?.serving ?? false,
        url: tailscaleUrl,
      },
    };
  };

  const applyListen = async (enabled: boolean): Promise<void> => {
    if (environment.bindOverride !== null) {
      throw new ConflictError('PROKOPAI_HOST (or --host) decides where Prokop listens. Remove it to change this setting.');
    }
    const before = read();
    if (before.listenOnNetwork === enabled) return;
    save({ ...before, listenOnNetwork: enabled });
    try {
      await listeners().rebind(bindHost());
    } catch (error: unknown) {
      save(before);
      const reason = error instanceof Error ? error.message : String(error);
      throw new HttpError(500, `Could not change where Prokop listens: ${reason}`, 'rebind_failed');
    }
    if (!enabled) options.onNetworkListeningDisabled?.();
  };

  const changed = async (): Promise<RemoteAccessStatus> => {
    options.onChanged?.();
    return buildStatus();
  };

  return {
    bindHost,

    isKnownHostname(hostname) {
      const target = hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (tailscaleCache?.dnsName === target) return true;
      return [...read().addresses, ...environmentAddresses()].some((url) => hostnameOf(url) === target);
    },

    pairingBaseUrls() {
      const settings = read();
      const urls = [...settings.addresses, ...environmentAddresses()];
      if (isWildcardOrNetwork(bindHost())) {
        urls.push(...suggestions(new Set(urls)).map((item) => item.url));
      }
      return Array.from(new Set(urls));
    },

    async status() {
      await loadTailscale();
      return buildStatus();
    },

    async setListenOnNetwork(enabled) {
      await applyListen(enabled);
      return changed();
    },

    async addAddress(input) {
      const url = normalizeAddress(input, listeners().endpoint().protocol);
      const settings = read();
      if (!settings.addresses.includes(url)) {
        if (settings.addresses.length >= MAX_ADDRESSES) throw new BadRequestError(`At most ${MAX_ADDRESSES} addresses can be saved.`);
        save({ ...settings, addresses: [...settings.addresses, url] });
      }
      // An address that points straight at this machine only works while listening on the network.
      if (isDirect(url) && environment.bindOverride === null) await applyListen(true);
      return changed();
    },

    async removeAddress(input) {
      const url = normalizeAddress(input, listeners().endpoint().protocol);
      const settings = read();
      save({ ...settings, addresses: settings.addresses.filter((item) => item !== url) });
      return changed();
    },

    async setTailscale(enabled) {
      const state = await loadTailscale();
      if (!state) throw new HttpError(422, 'Tailscale is not installed on this computer.', 'tailscale_missing');
      if (!state.running || !state.dnsName) {
        throw new HttpError(422, 'Tailscale is not connected. Sign in to Tailscale on this computer first.', 'tailscale_stopped');
      }
      const url = `https://${state.dnsName}`;
      const target = listeners().loopbackTarget();
      if (enabled) {
        try {
          await network.setTailscaleServe(true, target);
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new HttpError(422, `Tailscale could not share Prokop: ${reason}`, 'tailscale_serve_failed');
        }
        const settings = read();
        if (!settings.addresses.includes(url)) save({ ...settings, addresses: [...settings.addresses, url] });
      } else {
        if (state.serving) await network.setTailscaleServe(false, target);
        const settings = read();
        save({ ...settings, addresses: settings.addresses.filter((item) => item !== url) });
      }
      await loadTailscale();
      return changed();
    },

    async refreshTailscale() {
      await loadTailscale();
    },
  };
}
