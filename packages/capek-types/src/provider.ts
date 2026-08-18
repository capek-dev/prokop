export type ProviderType = string;

export type AuthType = 'api_key' | 'oauth' | 'none';

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  description?: string;
  authType: AuthType;
  connectable: boolean;
  /** Whether this provider supplies LLM models ('llm') or is a data/action service ('service'). */
  kind?: 'llm' | 'service';
}

export interface ProviderStatus {
  provider: string;
  connected: boolean;
  authorizationUrl?: string;
  flowId?: string;
  redirectStrategy?: string;
  redirectUri?: string;
  error?: string;
  reauthRequired?: boolean;
  connectedAt?: string;
  accountId?: string;
  displayName?: string;
  description?: string;
  authType?: AuthType;
  connectable?: boolean;
}

/** Generic OAuth token storage config (access/refresh token pair). */
export interface OAuthTokenConfig {
  type: 'oauth';
  provider: string;
  access: string;
  refresh: string;
  expires: number;
  connectedAt: string;
}

/** Codex-specific provider config — extends OAuthTokenConfig with account ID. */
export interface CodexProviderConfig extends OAuthTokenConfig {
  provider: 'codex';
  accountId?: string;
}

/** Gmail-specific provider config — stores the user's email address. */
export interface GmailProviderConfig extends OAuthTokenConfig {
  provider: 'gmail';
  email?: string;
  reauthRequired?: boolean;
}
