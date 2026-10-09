/** Persisted remote-access choices. `addresses` are origins other devices use to reach this server. */
export interface RemoteAccessSettings {
  listenOnNetwork: boolean;
  addresses: string[];
}

export interface RemoteAccessSettingsRepository {
  /** Raw stored value; the service validates it. Null when never saved. */
  read(): unknown;
  write(settings: RemoteAccessSettings): void;
}

export interface NetworkInterfaceAddress {
  interfaceName: string;
  address: string;
  family: 'IPv4' | 'IPv6';
}

export interface TailscaleState {
  /** Tailscale is connected to its tailnet. */
  running: boolean;
  /** MagicDNS name without the trailing dot, e.g. `machine.tailnet.ts.net`. */
  dnsName: string | null;
  ips: string[];
  /** `tailscale serve` forwards HTTPS 443 to this server's loopback target. */
  serving: boolean;
}

export interface RemoteAccessNetworkPort {
  interfaces(): NetworkInterfaceAddress[];
  /** Null when the Tailscale CLI is not installed. */
  tailscale(loopbackTarget: string): Promise<TailscaleState | null>;
  setTailscaleServe(enabled: boolean, loopbackTarget: string): Promise<void>;
}

/** The server's listeners, owned by the composition root. */
export interface ListenerControl {
  endpoint(): { host: string; port: number; protocol: 'http' | 'https' };
  /** Plain loopback URL a same-machine proxy (tailscale serve) forwards to. */
  loopbackTarget(): string;
  /** Re-binds the main listener; open connections stay up. Rejects and keeps the old bind on failure. */
  rebind(host: string): Promise<void>;
}
