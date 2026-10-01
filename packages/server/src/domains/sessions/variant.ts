/**
 * Session variant policy (the "default" variant state is removed).
 *
 * Every model that declares variants always runs a concrete variant:
 * catalogs order variants ascending (lowest thinking level first), the first
 * key is the model's default, and a stored variant survives only when it
 * exists on the effective model. Models without variants resolve to null.
 */

export interface VariantCatalogProvider {
  id: string;
  models: ReadonlyArray<{ id: string; variants?: Record<string, unknown> }>;
}

/** Ordered variant keys for a model within a ModelsConfig-shaped catalog. */
export function modelVariantKeys(
  providers: ReadonlyArray<VariantCatalogProvider>,
  modelId?: string | null,
  providerId?: string | null,
): string[] {
  if (!providers || !modelId) return [];
  const provider = providerId ? providers.find(p => p.id === providerId) : undefined;
  const model = provider
    ? provider.models.find(m => m.id === modelId)
    : providers.flatMap(p => p.models).find(m => m.id === modelId);
  return model?.variants ? Object.keys(model.variants) : [];
}

/**
 * Resolve the effective variant: keep the stored value when it is one of the
 * model's keys, otherwise fall to the first (lowest) key. An empty key list
 * (model without variants, or no model) resolves to null.
 */
export function resolveSessionVariant(variantKeys: readonly string[], stored?: string | null): string | null {
  if (variantKeys.length === 0) return null;
  if (stored && variantKeys.includes(stored)) return stored;
  return variantKeys[0];
}
