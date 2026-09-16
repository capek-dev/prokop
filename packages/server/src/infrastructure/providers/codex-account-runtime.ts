import type { OAuthTokenSet } from '@/domains/provider-accounts/oauth';
import { applyCodexRefresh, OAuthTokenRefreshError } from '@/domains/provider-accounts/oauth';
import type { CodexAccount, CodexAccountStore } from './codex-accounts';

const CODEX_API_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';

/** Pins credentials to a local account, including refresh and 401 retries. */
export class CodexAccountRuntime {
  private readonly refreshing = new Map<string, Promise<CodexAccount>>();

  constructor(
    private readonly store: CodexAccountStore,
    private readonly refresh: (token: string) => Promise<OAuthTokenSet>,
    private readonly fetch: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  private async credentials(id: string, rejectedRevision?: string): Promise<CodexAccount> {
    const account = this.store.get(id);
    if (!account || account.reauthRequired) throw new Error('Codex account requires connection in Settings.');
    if (account.config.expires > Date.now() && account.revision !== rejectedRevision) return account;
    const key = `${account.id}:${account.revision}`;
    const existing = this.refreshing.get(key);
    if (existing) return existing;
    const pending = this.refreshAccount(account);
    this.refreshing.set(key, pending);
    try {
      return await pending;
    } finally {
      this.refreshing.delete(key);
    }
  }

  private async refreshAccount(account: CodexAccount): Promise<CodexAccount> {
    let tokens: OAuthTokenSet;
    try {
      tokens = await this.refresh(account.config.refresh);
    } catch (error: unknown) {
      if (error instanceof OAuthTokenRefreshError && (error.code === 'invalid_grant' || error.status === 401)) {
        this.store.updateCredentials(account, account.config, true);
      }
      // Transient failures must not erase credentials or switch subscriptions.
      throw error;
    }
    const config = applyCodexRefresh({ ...account.config }, tokens, Date.now());
    if (config.accountId !== account.config.accountId) {
      this.store.updateCredentials(account, account.config, true);
      throw new Error('Codex refresh changed account identity. Reconnect this account in Settings.');
    }
    const saved = this.store.updateCredentials(account, config);
    if (!saved || saved.reauthRequired || saved.connectionId !== account.connectionId) {
      throw new Error('Codex account changed while refreshing. Retry the request.');
    }
    return saved;
  }

  async createFetch(): Promise<typeof globalThis.fetch> {
    const selected = this.store.get();
    if (!selected) throw new Error('Codex not connected. Select an account in Settings > LLM providers.');
    await this.credentials(selected.id);
    const codexFetch = async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      signal?.throwIfAborted();
      const current = await this.credentials(selected.id);
      signal?.throwIfAborted();
      if (current.connectionId !== selected.connectionId) throw new Error('Codex account reconnected. Retry the request.');
      const request = input instanceof Request ? input : undefined;
      const parsed = new URL(request ? request.url : String(input));
      const isCodexEndpoint = parsed.pathname.includes('/v1/responses') || parsed.pathname.includes('/chat/completions');
      const url = isCodexEndpoint ? new URL(CODEX_API_ENDPOINT) : parsed;
      const requestInit = request ? {
        method: request.method,
        body: request.body ? await request.clone().arrayBuffer() : undefined,
        signal: request.signal,
        redirect: request.redirect,
      } : {};
      const send = (account: CodexAccount) => {
        const headers = new Headers(init?.headers ?? request?.headers);
        headers.set('authorization', `Bearer ${account.config.access}`);
        headers.delete('ChatGPT-Account-Id');
        if (account.config.accountId) headers.set('ChatGPT-Account-Id', account.config.accountId);
        headers.set('originator', 'jean2');
        return this.fetch(url, { ...requestInit, ...init, headers });
      };
      const response = await send(current);
      if (response.status !== 401 || signal?.aborted) return response;
      await response.body?.cancel();
      const refreshed = await this.credentials(selected.id, current.revision);
      signal?.throwIfAborted();
      if (refreshed.connectionId !== selected.connectionId) throw new Error('Codex account reconnected. Retry the request.');
      return send(refreshed);
    };
    return Object.assign(codexFetch, { preconnect: this.fetch.preconnect });
  }
}
