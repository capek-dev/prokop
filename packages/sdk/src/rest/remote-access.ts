import type { HttpClient } from '../transport/http';

export type RemoteAccessKind = 'lan' | 'tailscale' | 'vpn' | 'proxy';

export interface RemoteAccessStatus {
  /** Prokop listens on the network, not only on its own machine. */
  listenOnNetwork: boolean;
  bindHost: string;
  /** PROKOPAI_HOST or --host decides the bind; the toggle is read-only. */
  bindLockedByEnvironment: boolean;
  endpoint: { protocol: 'http' | 'https'; port: number };
  /** Origins other devices use. `environment` entries come from PROKOPAI_ALLOWED_HOSTS. */
  addresses: Array<{ url: string; source: 'saved' | 'environment'; kind: RemoteAccessKind }>;
  /** Detected addresses not yet saved (LAN, Tailscale, other VPN interfaces). */
  suggestions: Array<{ url: string; kind: Exclude<RemoteAccessKind, 'proxy'> }>;
  tailscale: {
    installed: boolean;
    running: boolean;
    dnsName: string | null;
    serving: boolean;
    url: string | null;
  };
}

/** Where other devices reach this server. Requires the server's own machine. */
export class RemoteAccessRestNamespace {
  constructor(private http: HttpClient) {}

  status(options?: { signal?: AbortSignal }): Promise<RemoteAccessStatus> {
    return this.http.get('/remote-access', { signal: options?.signal });
  }

  setListenOnNetwork(listenOnNetwork: boolean): Promise<RemoteAccessStatus> {
    return this.http.put('/remote-access', { listenOnNetwork });
  }

  addAddress(url: string): Promise<RemoteAccessStatus> {
    return this.http.post('/remote-access/addresses', { url });
  }

  removeAddress(url: string): Promise<RemoteAccessStatus> {
    return this.http.delete(`/remote-access/addresses?url=${encodeURIComponent(url)}`);
  }

  setTailscale(enabled: boolean): Promise<RemoteAccessStatus> {
    return this.http.post('/remote-access/tailscale', { enabled });
  }
}
