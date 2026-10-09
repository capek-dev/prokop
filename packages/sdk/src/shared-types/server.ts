export interface SavedServer {
  id: string;
  name: string;
  url: string;
  token?: string;
  createdAt: string;
  /** Persistent server identity from `/api/info`; every route is verified against it. */
  installationId?: string;
  /** Other URLs that reach the same server (LAN, Tailscale, proxy), learned after connecting. */
  routes?: string[];
}

export interface QuickConnection {
  id: string;
  serverId: string;
  serverName: string;
  workspaceId?: string;
  workspaceName?: string;
  order: number;
}
