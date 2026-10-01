import { useState } from 'react';
import { toast } from 'sonner';
import type {
  ProkopaiClient,
  ModelWithStatus,
  ProviderAccountStatus,
  ProviderCredentialStatus,
} from '@prokopai/sdk';
import {
  useModelsConfigQuery,
  useProviderCredentialsQuery,
  useProvidersQuery,
  useSetModelDefaults,
  useSyncModels,
} from '@/hooks/queries';
import { RefreshCw, Loader2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProviderCard } from './providers-models/ProviderCard';

const FALLBACK_PROVIDER_NAMES: Record<string, string> = {
  minimax: 'MiniMax',
  openrouter: 'OpenRouter',
  'zhipu-coding': 'Z.AI Coding',
  deepseek: 'DeepSeek',
  codex: 'Codex (ChatGPT)',
};

function fallbackProviderName(id: string): string {
  return FALLBACK_PROVIDER_NAMES[id]
    || id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Compact default selector: provider, model, and variant apply immediately. */
function DefaultModelRow({
  sdkClient,
  providers,
  defaultProvider,
  defaultModel,
  defaultVariant,
}: {
  sdkClient: ProkopaiClient | null;
  providers: Array<{ id: string; name: string; models: ModelWithStatus[] }>;
  defaultProvider: string;
  defaultModel: string;
  defaultVariant: string | null;
}) {
  const setDefaultsMut = useSetModelDefaults(sdkClient);
  const [draftProvider, setDraftProvider] = useState<string | null>(null);

  const provider = draftProvider ?? defaultProvider;
  const models = providers.find(p => p.id === provider)?.models ?? [];

  // Variant options exist only for the stored default; a draft provider has
  // no model context until the model pick applies (which clears the variant
  // server-side to the new model's first key).
  const onStoredDefault = !draftProvider;
  const storedModel = onStoredDefault
    ? providers.find(p => p.id === defaultProvider)?.models.find(m => m.id === defaultModel)
    : undefined;
  const variantKeys = storedModel?.variants ? Object.keys(storedModel.variants) : [];
  const variantValue = defaultVariant && variantKeys.includes(defaultVariant)
    ? defaultVariant
    : variantKeys[0];

  const apply = async (next: { defaultModel: string; defaultVariant?: string | null }) => {
    try {
      await setDefaultsMut.mutateAsync({
        defaultProvider: provider,
        defaultModel: next.defaultModel,
        defaultVariant: next.defaultVariant ?? null,
      });
      setDraftProvider(null);
    } catch {
      // mutation hooks surface failures; keep the draft so the user can retry
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Default</span>
      <Select
        value={provider}
        onValueChange={(id) => setDraftProvider(id === defaultProvider ? null : id)}
        disabled={setDefaultsMut.isPending}
      >
        <SelectTrigger size="sm" className="min-w-28" aria-label="Default provider">
          <SelectValue placeholder="Provider" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {providers.map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Select
        value={defaultProvider === provider && !draftProvider ? defaultModel : undefined}
        onValueChange={(id) => apply({ defaultModel: id })}
        disabled={setDefaultsMut.isPending || models.length === 0}
      >
        <SelectTrigger size="sm" className="min-w-36" aria-label="Default model">
          <SelectValue placeholder={models.length === 0 ? 'No models' : 'Model'} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {models.map(m => (
              <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {onStoredDefault && variantKeys.length > 0 && (
        <Select
          value={variantValue}
          onValueChange={(v) => apply({ defaultModel: defaultModel, defaultVariant: v })}
          disabled={setDefaultsMut.isPending}
        >
          <SelectTrigger size="sm" className="min-w-28" aria-label="Default variant">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {variantKeys.map(key => (
                <SelectItem key={key} value={key}>{key}</SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {setDefaultsMut.isPending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
    </div>
  );
}

/** Registry sync behind one header button; mode picked from a menu, result as a toast. */
function SyncButton({ sdkClient }: { sdkClient: ProkopaiClient | null }) {
  const syncModelsMut = useSyncModels(sdkClient);

  const run = (mode: 'merge' | 'override') => {
    syncModelsMut.mutate(mode, {
      onSuccess: (result) => {
        if (result.mode === 'override') {
          toast.success(`Replaced with upstream (${result.totalProviders} providers, ${result.totalModels} models)`);
        } else if (result.addedProviders.length === 0 && result.addedModels.length === 0) {
          toast.success('Models already up to date');
        } else {
          const parts = [
            result.addedProviders.length > 0 ? `${result.addedProviders.length} provider(s)` : null,
            result.addedModels.length > 0 ? `${result.addedModels.length} model(s)` : null,
          ].filter(Boolean).join(', ');
          toast.success(`Synced ${parts}`);
        }
      },
      onError: (err) => toast.error('Sync failed', {
        description: err instanceof Error ? err.message : undefined,
      }),
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={syncModelsMut.isPending} aria-label="Sync models from registry">
          {syncModelsMut.isPending
            ? <Loader2 className="size-3.5 animate-spin" />
            : <RefreshCw className="size-3.5" />}
          <span className="hidden sm:inline">Sync</span>
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run('merge')}>
          Merge — add new models, keep existing
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => run('override')}>
          Override — replace all local models
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ProvidersModelsPanelProps {
  sdkClient: ProkopaiClient | null;
}

/**
 * Prokop model providers as one provider-centric list: each card owns its
 * connection (API key or subscription) together with its models, the default
 * model is a compact selector in the header, and registry sync lives behind
 * one header button.
 */
export function ProvidersModelsPanel({ sdkClient }: ProvidersModelsPanelProps) {
  const { data: config, isLoading: loading } = useModelsConfigQuery(sdkClient);
  const { data: credentialsData } = useProviderCredentialsQuery(sdkClient);
  const { data: oauthData } = useProvidersQuery(sdkClient);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const credentials: ProviderCredentialStatus[] = credentialsData?.providers ?? [];
  const oauthProviders: ProviderAccountStatus[] = oauthData?.providers ?? [];

  // Catalog providers first, then any registry provider without catalog
  // entries (e.g. OpenRouter until models are synced or added manually).
  const providers: Array<{ id: string; name: string; models: ModelWithStatus[] }> =
    (config?.providers ?? []).map(p => ({ id: p.id, name: p.name, models: p.models }));
  for (const credential of credentials) {
    if (!providers.some(p => p.id === credential.provider)) {
      providers.push({ id: credential.provider, name: fallbackProviderName(credential.provider), models: [] });
    }
  }
  for (const oauth of oauthProviders) {
    if (!providers.some(p => p.id === oauth.provider)) {
      providers.push({ id: oauth.provider, name: oauth.displayName || oauth.provider, models: [] });
    }
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <DefaultModelRow
          sdkClient={sdkClient}
          providers={providers}
          defaultProvider={config?.defaultProvider ?? ''}
          defaultModel={config?.defaultModel ?? ''}
          defaultVariant={config?.defaultVariant ?? null}
        />
        <SyncButton sdkClient={sdkClient} />
      </div>

      <div className="space-y-2">
        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            sdkClient={sdkClient}
            provider={provider}
            defaultProvider={config?.defaultProvider ?? ''}
            defaultModel={config?.defaultModel ?? ''}
            credential={credentials.find(c => c.provider === provider.id)}
            oauth={oauthProviders.find(o => o.provider === provider.id)}
          />
        ))}
      </div>
    </div>
  );
}
