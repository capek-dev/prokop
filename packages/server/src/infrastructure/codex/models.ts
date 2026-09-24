import type { CodexModel, CodexModelSelection } from '@prokopai/sdk';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { CodexAppServer, codexObject, spawnCodexAppServer, type CodexConnection } from './app-server';
function codexCliVersion(): string {
  const result = Bun.spawnSync(['codex', '--version'], { stdout: 'pipe', stderr: 'ignore' });
  const version = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !/^codex-cli 0\.156\./.test(version)) throw new Error('Codex CLI 0.156.x required');
  return version;
}

export interface CodexModelDependencies {
  connect(): CodexConnection;
  version(): string;
}

const defaultDependencies: CodexModelDependencies = { connect: spawnCodexAppServer, version: codexCliVersion };

export function getCodexModelSelection(sessionId: string): CodexModelSelection | null {
  const row = getDatabase().query<{ model: string; effort: string }, [string]>(
    'SELECT model, effort FROM codex_session_models WHERE session_id = ?',
  ).get(sessionId);
  return row ? { model: row.model, effort: row.effort } : null;
}

/** Fetch only the host CLI catalog. Never fall back to Prokop provider models. */
export async function listCodexModels(deps: CodexModelDependencies = defaultDependencies): Promise<CodexModel[]> {
  deps.version();
  const client = new CodexAppServer(deps.connect(), () => {});
  try {
    await client.initialize();
    const models: CodexModel[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const response = codexObject(await client.request('model/list', {
        limit: 100, ...(cursor ? { cursor } : {}),
      }));
      if (!response || !Array.isArray(response.data)) throw new Error('Invalid Codex model catalog');
      for (const raw of response.data) {
        const entry = codexObject(raw);
        if (!entry || entry.hidden === true) continue;
        const model = entry.model;
        const efforts = entry.supportedReasoningEfforts;
        if (typeof model !== 'string' || !model || typeof entry.displayName !== 'string'
          || !Array.isArray(efforts) || typeof entry.defaultReasoningEffort !== 'string') {
          throw new Error('Invalid Codex model catalog');
        }
        const supportedEfforts = efforts.map(option => {
          const effort = codexObject(option)?.reasoningEffort;
          if (typeof effort !== 'string' || !effort) throw new Error('Invalid Codex reasoning effort');
          return effort;
        });
        if (!supportedEfforts.includes(entry.defaultReasoningEffort) || seen.has(model)) {
          throw new Error('Invalid Codex model catalog');
        }
        seen.add(model);
        models.push({ model, name: entry.displayName, supportedEfforts,
          defaultEffort: entry.defaultReasoningEffort, isDefault: entry.isDefault === true });
      }
      if (response.nextCursor === null) return models;
      if (typeof response.nextCursor !== 'string' || !response.nextCursor || response.nextCursor === cursor) {
        throw new Error('Invalid Codex model cursor');
      }
      cursor = response.nextCursor;
    }
    throw new Error('Codex model catalog exceeds page limit');
  } finally {
    await client.close();
  }
}

export function saveCodexModelSelection(sessionId: string, selection: CodexModelSelection): void {
  const result = getDatabase().run(`INSERT INTO codex_session_models (session_id, model, effort)
    SELECT id, ?, ? FROM sessions WHERE id = ? AND harness = 'codex-cli'
    ON CONFLICT(session_id) DO UPDATE SET model = excluded.model, effort = excluded.effort`,
  [selection.model, selection.effort, sessionId]);
  if (result.changes !== 1) throw new Error('Codex session unavailable');
}
