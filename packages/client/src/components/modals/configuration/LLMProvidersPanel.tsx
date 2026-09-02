import type { ProkopaiClient } from '@prokopai/sdk';
import { OAuthProvidersPanel } from './OAuthProvidersPanel';
import { ProviderCredentialsPanel } from './ProviderCredentialsPanel';

interface LLMProvidersPanelProps {
  sdkClient: ProkopaiClient | null;
}

export function LLMProvidersPanel({ sdkClient }: LLMProvidersPanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <p className="text-sm text-muted-foreground">
        Connect the providers you use for language models with an API key or account subscription.
      </p>

      <section aria-labelledby="api-key-providers-heading" className="space-y-3">
        <div className="space-y-1">
          <h3 id="api-key-providers-heading" className="text-sm font-semibold">
            API keys
          </h3>
          <p className="text-xs text-muted-foreground">
            Keys are stored in ~/.prokopai/.env and never exposed to the client.
          </p>
        </div>
        <ProviderCredentialsPanel sdkClient={sdkClient} embedded />
      </section>

      <section aria-labelledby="subscription-providers-heading" className="space-y-3 border-t pt-5">
        <div className="space-y-1">
          <h3 id="subscription-providers-heading" className="text-sm font-semibold">
            Account subscriptions
          </h3>
          <p className="text-xs text-muted-foreground">
            Connect an existing provider subscription. No API key is needed.
          </p>
        </div>
        <OAuthProvidersPanel sdkClient={sdkClient} embedded />
      </section>
    </div>
  );
}
