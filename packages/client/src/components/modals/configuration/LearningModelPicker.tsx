import type { LearningReviewer, ModelWithStatus, Preconfig } from '@prokopai/sdk';
import { ModelSelector } from '@/components/chat/ModelSelector';
import { VariantSelector } from '@/components/chat/VariantSelector';
import { Button } from '@/components/ui/button';

interface LearningModelPickerProps {
  models: ModelWithStatus[];
  preconfig: Preconfig | undefined;
  value: LearningReviewer['modelOverride'];
  onChange(value: LearningReviewer['modelOverride']): void;
}

export function LearningModelPicker({ models, preconfig, value, onChange }: LearningModelPickerProps) {
  const modelId = value ? value.modelId : preconfig?.model;
  const providerId = value ? value.providerId : preconfig?.provider;
  const model = models.find(candidate => candidate.id === modelId && candidate.providerId === providerId);
  // No default-variant state: picking a model resets to its first (lowest) variant.
  const firstVariantOf = (nextModelId: string, nextProviderId: string): string | null => {
    const target = models.find(m => m.id === nextModelId && m.providerId === nextProviderId);
    return target?.variants ? Object.keys(target.variants)[0] ?? null : null;
  };
  return <div className="flex min-w-0 flex-col gap-1">
    <div className="flex flex-wrap items-center gap-2">
      <ModelSelector models={models} selectedModelId={modelId} selectedProviderId={providerId}
        onChangeModel={(modelId, providerId) => onChange({ modelId, providerId, variant: firstVariantOf(modelId, providerId) })} />
      <VariantSelector variants={model?.variants} selectedVariant={value ? value.variant ?? null : preconfig?.variant ?? null}
        onChangeVariant={variant => { if (modelId && providerId) onChange({ modelId, providerId, variant }); }} />
      {value && <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Use agent model</Button>}
    </div>
    {!value && <p className="text-xs text-muted-foreground">Using the agent model and variant.</p>}
    {value && !model && <p role="status" className="text-xs text-muted-foreground">Unavailable model: {value.modelId} ({value.providerId})</p>}
  </div>;
}
