import type { LanguageModel } from 'ai';
import type { OAuthRedirectStrategy, ProviderDescriptor, ProviderStatus } from '@capekai/types';

export interface ModelFactoryOptions {
  modelId: string;
  providerId: string;
  systemPrompt: string;
  sessionId?: string;
}

export interface ModelFactoryResult {
  model: LanguageModel;
  useProviderInstructions?: boolean;
  omitMaxOutputTokens?: boolean;
  providerOptions?: Record<string, Record<string, unknown>>;
}

export interface ConnectOptions {
  redirectStrategy?: OAuthRedirectStrategy;
}

export interface ConnectResult {
  authorizationUrl?: string;
  flowId?: string;
  redirectStrategy?: OAuthRedirectStrategy;
  redirectUri?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  id_token?: string;
  token_type?: string;
}

export interface ConnectableProvider {
  descriptor: ProviderDescriptor;
  getStatus(): ProviderStatus;
  connect(options?: ConnectOptions): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  onTokensReceived(tokens: TokenResponse): Promise<void>;
  createModel?(options: ModelFactoryOptions): Promise<ModelFactoryResult>;
}
