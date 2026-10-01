import { probeClaudeModels } from './model-probe';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { CodexModel, CodexModelSelection } from '@prokopai/sdk';
import { getDatabase } from '@/infrastructure/sqlite/database';

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

/** The CLI catalog only changes with the installed CLI version; a probe boots
 * the whole CLI process, so callers share one probe per TTL window. */
const CATALOG_TTL_MS = 10 * 60_000;

export function createClaudeModelCatalogCache(
  probe: () => Promise<unknown> = probeClaudeModels,
  ttlMs: number = CATALOG_TTL_MS,
): () => Promise<unknown> {
  let cache: { at: number; promise: Promise<unknown> } | null = null;
  return () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const promise = probe().catch((err: unknown) => {
        // Clear only our own entry; a newer probe may already be cached.
        if (cache?.promise === promise) cache = null;
        throw err;
      });
      cache = { at: Date.now(), promise };
    }
    return cache.promise;
  };
}

const cachedClaudeCatalog = createClaudeModelCatalogCache();

/** Validated catalog over the shared probe cache. */
export function listCachedClaudeModels(): Promise<CodexModel[]> {
  return listClaudeModels(cachedClaudeCatalog);
}

/** Only advertise concrete models and effort levels reported by the installed CLI. */
export async function listClaudeModels(discover: () => Promise<unknown> = probeClaudeModels): Promise<CodexModel[]> {
  const catalog = await discover();
  if (!Array.isArray(catalog) || catalog.length === 0 || catalog.length > 100) {
    throw new Error('Invalid Claude CLI model catalog');
  }
  const models: CodexModel[] = [];
  const seen = new Set<string>();
  for (const raw of catalog as ModelInfo[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.value !== 'string'
      || typeof raw.displayName !== 'string' || (raw.supportedEffortLevels !== undefined
        && !Array.isArray(raw.supportedEffortLevels))) {
      throw new Error('Invalid Claude CLI model catalog');
    }
    const model = raw.resolvedModel ?? raw.value;
    const name = raw.description?.split(' · ')[0]?.trim() || raw.displayName.trim();
    if (!/^claude-[a-z0-9-]{1,180}$/.test(model) || !name || name.length > 200) {
      throw new Error('Invalid Claude CLI model catalog');
    }
    const efforts = raw.supportedEffortLevels ?? [];
    if (raw.supportsEffort === true && !efforts.length
      || efforts.some(effort => typeof effort !== 'string' || !EFFORTS.has(effort))
      || new Set(efforts).size !== efforts.length) {
      throw new Error('Invalid Claude CLI model effort');
    }
    if (seen.has(model)) continue;
    seen.add(model);
    models.push({ model, name, supportedEfforts: efforts.length ? efforts : ['default'],
      defaultEffort: efforts.includes('high') ? 'high' : efforts[0] ?? 'default', isDefault: models.length === 0 });
  }
  if (!models.length) throw new Error('Invalid Claude CLI model catalog');
  return models;
}

export function getClaudeModelSelection(id: string): CodexModelSelection | null {
  const row = getDatabase().query<{ model: string; effort: string }, [string]>(
    'SELECT model, effort FROM claude_session_models WHERE session_id = ?',
  ).get(id);
  return row ? { model: row.model, effort: row.effort } : null;
}

export function saveClaudeModelSelection(id: string, selection: CodexModelSelection): void {
  const result = getDatabase().run(`INSERT INTO claude_session_models (session_id, model, effort)
    SELECT id, ?, ? FROM sessions WHERE id = ? AND harness = 'claude-cli'
    ON CONFLICT(session_id) DO UPDATE SET model = excluded.model, effort = excluded.effort`,
  [selection.model, selection.effort, id]);
  if (result.changes !== 1) throw new Error('Claude session unavailable');
}
