import { useState } from 'react';
import { toast } from 'sonner';
import type {
  ProkopaiClient,
  ModelRuntimeStatus,
  ModelWithStatus,
  ProviderAccountStatus,
  ProviderCredentialStatus,
} from '@prokopai/sdk';
import { useDeleteModel } from '@/hooks/queries';
import { Plus, Pencil, Trash2, ChevronRight, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { ProviderCredentialsPanel } from '../ProviderCredentialsPanel';
import { OAuthProvidersPanel } from '../OAuthProvidersPanel';
import { ModelEditorForm } from './ModelEditorForm';

function ModelStatusDot({ status }: { status: ModelRuntimeStatus }) {
  if (status.usable) {
    return <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" title="Usable" />;
  }
  if (status.providerSupported && !status.providerConfigured) {
    return <span className="size-1.5 rounded-full bg-amber-500 shrink-0" title="Needs configuration" />;
  }
  return <span className="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" title="Unsupported" />;
}

interface ProviderCardProps {
  sdkClient: ProkopaiClient | null;
  provider: { id: string; name: string; models: ModelWithStatus[] };
  defaultProvider: string;
  defaultModel: string;
  credential?: ProviderCredentialStatus;
  oauth?: ProviderAccountStatus;
}

/**
 * One provider = one card: connection state and its models live together.
 * Collapsed by default; expanding reveals the credential control, the compact
 * model list, and the add/edit/delete model actions. Providers themselves are
 * read-only catalog entries (models.json or registry sync owns them).
 */
export function ProviderCard({
  sdkClient,
  provider,
  defaultProvider,
  defaultModel,
  credential,
  oauth,
}: ProviderCardProps) {
  const deleteModelMut = useDeleteModel(sdkClient);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<
    null | { kind: 'new-model' } | { kind: 'model'; model: ModelWithStatus }
  >(null);
  const [deleteModelTarget, setDeleteModelTarget] = useState<ModelWithStatus | null>(null);
  const [deletingModel, setDeletingModel] = useState(false);

  const status = oauth
    ? oauth.reauthRequired
      ? { tone: 'amber' as const, label: 'Reconnect' }
      : oauth.connected
        ? { tone: 'green' as const, label: 'Connected' }
        : { tone: 'muted' as const, label: 'Not connected' }
    : credential
      ? credential.configured
        ? { tone: 'green' as const, label: 'Connected' }
        : { tone: 'amber' as const, label: 'Needs key' }
      : { tone: 'muted' as const, label: 'Custom' };
  const dotClass = status.tone === 'green'
    ? 'bg-emerald-500'
    : status.tone === 'amber' ? 'bg-amber-500' : 'bg-muted-foreground/40';
  const isDefaultProvider = provider.id === defaultProvider;

  const handleDeleteModel = async () => {
    if (!deleteModelTarget) return;
    setDeletingModel(true);
    try {
      await deleteModelMut.mutateAsync({ providerId: provider.id, modelId: deleteModelTarget.id });
      setDeleteModelTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete model';
      toast.error('Failed to delete model', { description: message });
    } finally {
      setDeletingModel(false);
    }
  };

  return (
    <Collapsible
      open={expanded || editor !== null}
      onOpenChange={setExpanded}
      className={cn('rounded-lg border', status.tone !== 'green' && 'opacity-80')}
    >
      <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors">
        <ChevronRight
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', (expanded || editor !== null) && 'rotate-90')}
        />
        <span className={cn('size-2 rounded-full shrink-0', dotClass)} />
        <span className="text-sm font-medium truncate min-w-0">{provider.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {provider.models.length > 0
            ? `${provider.models.length} model${provider.models.length !== 1 ? 's' : ''}`
            : 'no models'}
        </span>
        {isDefaultProvider && (
          <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0 h-4 gap-0.5">
            <Star className="size-2.5" />
            Default
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground shrink-0">{status.label}</span>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {editor ? (
          <div className="border-t p-3">
            <ModelEditorForm
              sdkClient={sdkClient}
              providerId={provider.id}
              providerName={provider.name}
              model={editor.kind === 'model' ? editor.model : null}
              onDone={() => setEditor(null)}
            />
          </div>
        ) : (
          <div className="border-t px-3 py-3 space-y-3">
            {oauth && <OAuthProvidersPanel sdkClient={sdkClient} provider={provider.id} embedded />}
            {!oauth && credential && <ProviderCredentialsPanel sdkClient={sdkClient} provider={provider.id} embedded />}
            {!oauth && !credential && (
              <p className="text-xs text-muted-foreground">
                Custom provider. Set its API key in ~/.prokopai/.env to use its models.
              </p>
            )}

            <div className="space-y-0.5">
              {provider.models.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">
                  No models in the catalog. Add one or sync from the registry.
                </p>
              ) : (
                provider.models.map((model) => {
                  const isDefault = model.id === defaultModel && provider.id === defaultProvider;
                  return (
                    <div key={model.id} className="flex items-center gap-2 py-1.5 rounded hover:bg-muted/50">
                      <ModelStatusDot status={model.runtimeStatus} />
                      <span className="text-sm truncate min-w-0" title={model.id}>{model.name}</span>
                      {isDefault && (
                        <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0 h-4 gap-0.5">
                          <Star className="size-2.5" />
                          Default
                        </Badge>
                      )}
                      <div className="ml-auto flex items-center gap-0.5 shrink-0">
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setEditor({ kind: 'model', model })}
                          title="Edit model"
                        >
                          <Pencil className="size-2.5" />
                        </Button>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => setDeleteModelTarget(model)}
                          title="Delete model"
                        >
                          <Trash2 className="size-2.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-1 pt-1 border-t">
              <Button size="sm" variant="ghost" onClick={() => setEditor({ kind: 'new-model' })}>
                <Plus className="size-3" />
                Add model
              </Button>
            </div>
          </div>
        )}
      </CollapsibleContent>

      <ConfirmDialog
        open={deleteModelTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteModelTarget(null); }}
        title="Delete Model"
        description={`Are you sure you want to delete "${deleteModelTarget?.name}"?${deleteModelTarget?.id === defaultModel && provider.id === defaultProvider ? ' Warning: This is the current default model.' : ''}`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteModel}
        loading={deletingModel}
      />
    </Collapsible>
  );
}
