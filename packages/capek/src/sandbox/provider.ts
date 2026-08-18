import type { LanguageModel } from 'ai';
import type { ProviderDescriptor, ProviderStatus } from '@capekai/types';
import type {
  ConnectableProvider,
  ModelFactoryOptions,
  ModelFactoryResult,
  TokenResponse,
} from '../providers/types';
import { SandboxLanguageModel } from './model';

export class SandboxProvider implements ConnectableProvider {
  readonly descriptor: ProviderDescriptor = {
    id: 'sandbox',
    displayName: 'Sandbox (Interactive Mock)',
    description: 'Interactive mock provider for sandbox testing',
    authType: 'none',
    connectable: false,
  };

  getStatus(): ProviderStatus {
    return {
      provider: this.descriptor.id,
      connected: true,
      displayName: this.descriptor.displayName,
      description: this.descriptor.description,
      authType: this.descriptor.authType,
      connectable: this.descriptor.connectable,
    };
  }

  async connect() {
    return {};
  }

  async onTokensReceived(_tokens: TokenResponse): Promise<void> {
    // Sandbox provider doesn't use OAuth
  }

  async disconnect(): Promise<void> {
  }

  async createModel(options: ModelFactoryOptions): Promise<ModelFactoryResult> {
    return {
      model: new SandboxLanguageModel({
        sessionId: options.sessionId ?? 'default',
        modelId: options.modelId,
        providerId: options.providerId,
      }) as unknown as LanguageModel,
      useProviderInstructions: false,
      omitMaxOutputTokens: true,
    };
  }
}
