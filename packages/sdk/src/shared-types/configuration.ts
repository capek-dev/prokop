export interface ProviderCredentialStatus {
  provider: string;
  configured: boolean;
}

export interface ProviderCredentialsResponse {
  providers: ProviderCredentialStatus[];
}

export interface SetProviderCredentialRequest {
  apiKey: string;
}

export interface ModelRuntimeStatus {
  providerSupported: boolean;
  providerConfigured: boolean;
  usable: boolean;
}

export interface ModelWithStatus {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: {
      text?: boolean;
      image?: boolean;
      video?: boolean;
      file?: string[];
    };
    structuredOutput?: {
      mode: 'native' | 'prompt';
    };
  };
  providerId: string;
  providerName: string;
  runtimeStatus: ModelRuntimeStatus;
}

export interface ProviderWithStatus {
  id: string;
  name: string;
  models: ModelWithStatus[];
}

export interface ModelsConfigResponse {
  providers: ProviderWithStatus[];
  defaultModel: string;
  defaultProvider: string;
  defaultVariant?: string | null;
}

export interface CreateModelRequest {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: {
      text?: boolean;
      image?: boolean;
      video?: boolean;
      file?: string[];
    };
    structuredOutput?: {
      mode: 'native' | 'prompt';
    };
  };
}

export interface UpdateModelRequest {
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: {
      text?: boolean;
      image?: boolean;
      video?: boolean;
      file?: string[];
    };
    structuredOutput?: {
      mode: 'native' | 'prompt';
    };
  };
}

export interface SetDefaultsRequest {
  defaultModel: string;
  defaultProvider: string;
  defaultVariant?: string | null;
}

export interface SyncResult {
  mode: 'merge' | 'override';
  addedProviders: string[];
  addedModels: string[];
  totalProviders: number;
  totalModels: number;
}

export interface CreatePromptRequest {
  name: string;
  content: string;
}

export interface UpdatePromptRequest {
  content: string;
}
