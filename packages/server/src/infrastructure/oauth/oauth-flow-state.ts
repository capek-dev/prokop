import type { OAuthProviderConfig } from '@prokopai/sdk';
import type { PkceCodes } from '@/domains/provider-accounts';

export interface PendingOAuthFlow {
  providerId: string;
  state: string;
  pkce: PkceCodes;
  redirectUri: string;
  timeout: ReturnType<typeof setTimeout>;
}

interface LocalServerEntry {
  server: ReturnType<typeof Bun.serve>;
  paths: Set<string>;
  activeFlows: number;
}

export interface OAuthFlowStateDependencies {
  handleLocalhostCallback(url: URL): Promise<Response>;
}

export class OAuthFlowState {
  readonly configs = new Map<string, OAuthProviderConfig>();
  readonly pending = new Map<string, PendingOAuthFlow>();
  private readonly localServers = new Map<number, LocalServerEntry>();

  constructor(private readonly dependencies: OAuthFlowStateDependencies) {}

  ensureLocalServer(redirectUri: string): void {
    const parsed = new URL(redirectUri);
    if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') return;

    const port = parseInt(parsed.port, 10);
    if (!port || isNaN(port)) return;

    const existing = this.localServers.get(port);
    if (existing) {
      existing.paths.add(parsed.pathname);
      existing.activeFlows++;
      return;
    }

    const paths = new Set([parsed.pathname]);
    const server = Bun.serve({
      port,
      fetch: (request) => {
        const url = new URL(request.url);
        if (paths.has(url.pathname)) return this.dependencies.handleLocalhostCallback(url);
        return new Response('Not found', { status: 404 });
      },
    });
    this.localServers.set(port, { server, paths, activeFlows: 1 });
  }

  stopLocalServerForPath(redirectUri: string): void {
    const port = parseInt(new URL(redirectUri).port, 10);
    if (!port || isNaN(port)) return;

    const entry = this.localServers.get(port);
    if (!entry) return;

    entry.activeFlows--;
    if (entry.activeFlows <= 0) {
      entry.server.stop();
      this.localServers.delete(port);
    }
  }

  dispose(): void {
    for (const flow of this.pending.values()) clearTimeout(flow.timeout);
    this.pending.clear();
    for (const entry of this.localServers.values()) entry.server.stop();
    this.localServers.clear();
  }
}
