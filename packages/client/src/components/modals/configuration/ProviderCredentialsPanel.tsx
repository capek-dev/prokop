import { useState } from 'react';
import type { ProkopaiClient, ProviderCredentialStatus } from '@prokopai/sdk';
import { useProviderCredentialsQuery, useSetProviderCredential, useClearProviderCredential } from '@/hooks/queries';
import { Key, Check, X, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
  embedded?: boolean;
}

export function ProviderCredentialsPanel({ sdkClient, embedded = false }: PanelProps) {
  const { data: credentialsData, isLoading: loading } = useProviderCredentialsQuery(sdkClient);
  const setCredentialMut = useSetProviderCredential(sdkClient);
  const clearCredentialMut = useClearProviderCredential(sdkClient);
  const providers: ProviderCredentialStatus[] = credentialsData?.providers ?? [];
  const [error, setError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleSetKey = async (provider: string) => {
    if (!apiKeyInput.trim()) return;
    setActionLoading(provider);
    try {
      await setCredentialMut.mutateAsync({ provider, body: { apiKey: apiKeyInput.trim() } });
      setEditingProvider(null);
      setApiKeyInput('');
      setShowKey(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set key');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearKey = async (provider: string) => {
    setActionLoading(provider);
    try {
      await clearCredentialMut.mutateAsync(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear key');
    } finally {
      setActionLoading(null);
    }
  };

  const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    zhipu: 'Z.AI',
    'zhipu-coding': 'Z.AI Coding',
  };

  const formatProviderName = (provider: string): string => {
    return PROVIDER_DISPLAY_NAMES[provider] || provider.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && providers.length === 0) {
    return (
      <div className="p-4 text-sm text-destructive">{error}</div>
    );
  }

  return (
    <div className={embedded ? 'space-y-4' : 'p-3 sm:p-4 space-y-4'}>
      {!embedded && (
        <p className="text-sm text-muted-foreground">
          Manage API keys for LLM providers. Keys are stored in ~/.prokopai/.env and never exposed to the client.
        </p>
      )}

      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      <div className="space-y-2">
        {providers.map((cred) => (
          <div
            key={cred.provider}
            className="flex items-center justify-between p-3 rounded-lg border"
          >
            <div className="flex items-center gap-3">
              <Key className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">{formatProviderName(cred.provider)}</span>
              <Badge variant={cred.configured ? 'default' : 'secondary'}>
                {cred.configured ? 'Configured' : 'Not set'}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              {editingProvider === cred.provider ? (
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Enter API key..."
                      className="w-full sm:w-48 h-8 text-sm pr-8"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSetKey(cred.provider);
                        if (e.key === 'Escape') {
                          setEditingProvider(null);
                          setApiKeyInput('');
                        }
                      }}
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-8 w-8"
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSetKey(cred.provider)}
                    disabled={!apiKeyInput.trim() || actionLoading === cred.provider}
                  >
                    {actionLoading === cred.provider ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Check className="size-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingProvider(null);
                      setApiKeyInput('');
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingProvider(cred.provider);
                      setApiKeyInput('');
                      setShowKey(false);
                    }}
                    disabled={actionLoading === cred.provider}
                  >
                    {cred.configured ? 'Update' : 'Set Key'}
                  </Button>
                  {cred.configured && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleClearKey(cred.provider)}
                      disabled={actionLoading === cred.provider}
                    >
                      {actionLoading === cred.provider ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Trash2 className="size-3" />
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
