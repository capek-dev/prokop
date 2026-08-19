import type { ModelsConfig } from '@/config';

/**
 * Single strict models.json schema validator (P3.1).
 *
 * Shared by the cached config loader (`config/index.ts`), the CRUD document
 * store (`config/models.ts`), and the registry sync (`config/models-sync.ts`).
 * Uniqueness of provider ids and per-provider model ids, default provider and
 * default model existence, and full capability/variant shape checks.
 */
export function validateModelsDocument(config: unknown): config is ModelsConfig {
  if (!config || typeof config !== 'object') {
    return false;
  }

  const c = config as Record<string, unknown>;

  if (!Array.isArray(c.providers)) {
    return false;
  }

  if (typeof c.defaultModel !== 'string' || c.defaultModel.trim() === '') {
    return false;
  }

  if (typeof c.defaultProvider !== 'string' || c.defaultProvider.trim() === '') {
    return false;
  }

  const providerIds = new Set<string>();
  const allModelIds = new Set<string>();

  for (const provider of c.providers) {
    if (!provider || typeof provider !== 'object') {
      return false;
    }

    const p = provider as Record<string, unknown>;

    if (typeof p.id !== 'string' || p.id.trim() === '') {
      return false;
    }

    if (typeof p.name !== 'string' || p.name.trim() === '') {
      return false;
    }

    if (providerIds.has(p.id)) {
      return false;
    }
    providerIds.add(p.id);

    if (!Array.isArray(p.models)) {
      return false;
    }

    const providerModelIds = new Set<string>();

    for (const model of p.models) {
      if (!model || typeof model !== 'object') {
        return false;
      }

      const m = model as Record<string, unknown>;

      if (typeof m.id !== 'string' || m.id.trim() === '') {
        return false;
      }

      if (typeof m.name !== 'string') {
        return false;
      }

      if (typeof m.contextWindow !== 'number' || m.contextWindow <= 0) {
        return false;
      }

      if (m.tier !== 'budget' && m.tier !== 'standard' && m.tier !== 'premium') {
        return false;
      }

      if (m.maxOutputTokens !== undefined) {
        if (typeof m.maxOutputTokens !== 'number' || m.maxOutputTokens <= 0) {
          return false;
        }
      }

      if (m.variants !== undefined) {
        if (typeof m.variants !== 'object' || m.variants === null || Array.isArray(m.variants)) {
          return false;
        }
        for (const v of Object.values(m.variants) as unknown[]) {
          if (typeof v !== 'object' || v === null || Array.isArray(v)) {
            return false;
          }
          const variant = v as Record<string, unknown>;
          if (typeof variant.providerOptions !== 'object' || variant.providerOptions === null || Array.isArray(variant.providerOptions)) {
            return false;
          }
        }
      }

      if (m.capabilities !== undefined) {
        if (typeof m.capabilities !== 'object' || m.capabilities === null || Array.isArray(m.capabilities)) {
          return false;
        }
        const cap = m.capabilities as Record<string, unknown>;
        if (cap.input !== undefined) {
          if (typeof cap.input !== 'object' || cap.input === null || Array.isArray(cap.input)) {
            return false;
          }
          const inp = cap.input as Record<string, unknown>;
          if (inp.text !== undefined && typeof inp.text !== 'boolean') return false;
          if (inp.image !== undefined && typeof inp.image !== 'boolean') return false;
          if (inp.video !== undefined && typeof inp.video !== 'boolean') return false;
          if (inp.file !== undefined && typeof inp.file !== 'boolean' && !Array.isArray(inp.file)) return false;
        }
        if (cap.structuredOutput !== undefined) {
          if (typeof cap.structuredOutput !== 'object' || cap.structuredOutput === null || Array.isArray(cap.structuredOutput)) {
            return false;
          }
          const so = cap.structuredOutput as Record<string, unknown>;
          if (so.mode !== 'native' && so.mode !== 'prompt') return false;
        }
      }

      if (providerModelIds.has(m.id)) {
        return false;
      }
      providerModelIds.add(m.id);
      allModelIds.add(m.id);
    }
  }

  const providerIdsArray = Array.from(providerIds);
  if (!providerIdsArray.includes(c.defaultProvider)) {
    return false;
  }

  if (!allModelIds.has(c.defaultModel)) {
    return false;
  }

  return true;
}
