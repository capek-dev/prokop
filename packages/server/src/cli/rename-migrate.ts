/**
 * `prokopai migrate` — one-shot migration from the jean2 identity to prokopai.
 *
 * Steps (each idempotent, each reported):
 *   1. Move ~/.jean2 to ~/.prokopai when only the legacy dir exists
 *   2. Rewrite .env keys JEAN2_* to PROKOPAI_* inside the data dir
 *   3. Rename agents/<id>/home/.jean2 to .prokopai on disk
 *   4. Rewrite workspaces.path rows in the db (~/.jean2 prefix to ~/.prokopai)
 *
 * Safe to re-run; steps that find nothing to do report as skipped.
 */

import { existsSync, renameSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { getDatabasePath } from '@/infrastructure/runtime/environment';
import { getEnvFilePath, getDataDir, LEGACY_JEAN2_DIR_NAME, PROKOPAI_DIR_NAME } from '@/infrastructure/runtime/paths';
import { rewriteWorkspacePathsForRename } from '@/infrastructure/sqlite/rename-migration';

export interface RenameMigrationResult {
  success: boolean;
  error?: string;
  steps: RenameMigrationStepResult[];
}

export interface RenameMigrationStepResult {
  step: string;
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

export interface RenameMigrationOptions {
  /** Skip the directory move (dry-run style safety valve for exotic setups). */
  skipDirMove?: boolean;
}

function migrateEnvFileKeys(): RenameMigrationStepResult {
  const envPath = getEnvFilePath();
  if (!existsSync(envPath)) {
    return { step: 'env-keys', status: 'skipped', detail: 'no .env file' };
  }

  let content: string;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { step: 'env-keys', status: 'failed', detail: message };
  }

  let rewritten = 0;
  const updated = content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return line;
      }
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1 || !trimmed.startsWith('JEAN2_')) {
        return line;
      }
      rewritten++;
      return `PROKOPAI_${trimmed.slice('JEAN2_'.length)}`;
    })
    .join('\n');

  if (rewritten === 0) {
    return { step: 'env-keys', status: 'skipped', detail: 'no JEAN2_* keys found' };
  }

  try {
    writeFileSync(envPath, updated, 'utf-8');
    return { step: 'env-keys', status: 'done', detail: `rewrote ${rewritten} keys` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { step: 'env-keys', status: 'failed', detail: message };
  }
}

function migrateAgentHomeDirs(dataDir: string): RenameMigrationStepResult {
  const agentsRoot = join(dataDir, 'agents');
  if (!existsSync(agentsRoot)) {
    return { step: 'agent-homes', status: 'skipped', detail: 'no agents directory' };
  }

  let renamed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const legacy = join(agentsRoot, entry.name, 'home', LEGACY_JEAN2_DIR_NAME);
    if (!existsSync(legacy)) continue;
    const canonical = join(agentsRoot, entry.name, 'home', PROKOPAI_DIR_NAME);
    if (existsSync(canonical)) {
      // Both exist: canonical wins, leave legacy alone (resolution already
      // prefers canonical). Surface it so the user can clean up manually.
      failures.push(`${legacy} (canonical exists, left untouched)`);
      failed++;
      continue;
    }
    try {
      renameSync(legacy, canonical);
      renamed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${legacy}: ${message}`);
      failed++;
    }
  }

  if (renamed === 0 && failed === 0) {
    return { step: 'agent-homes', status: 'skipped', detail: 'no legacy agent home dirs' };
  }

  const detail = `renamed ${renamed}${failed > 0 ? `, ${failed} left: ${failures.join('; ')}` : ''}`;
  return { step: 'agent-homes', status: failed > 0 && renamed === 0 ? 'failed' : 'done', detail };
}

function migrateWorkspacePaths(dataDir: string): RenameMigrationStepResult {
  const dbPath = getDatabasePath() ?? join(dataDir, 'data', 'agent.db');
  const result = rewriteWorkspacePathsForRename(dbPath);
  return { step: 'workspace-paths', status: result.status, detail: result.detail };
}

export function runProkopaiRenameMigration(options?: RenameMigrationOptions): RenameMigrationResult {
  const steps: RenameMigrationStepResult[] = [];
  const legacyHome = join(homedir(), LEGACY_JEAN2_DIR_NAME);
  const canonicalHome = join(homedir(), PROKOPAI_DIR_NAME);

  // Step 1: directory move. Only when legacy exists and canonical does not —
  // after this, Paths resolution picks up the canonical dir automatically.
  if (options?.skipDirMove) {
    steps.push({ step: 'dir-move', status: 'skipped', detail: 'skipped by option' });
  } else if (existsSync(canonicalHome)) {
    steps.push({ step: 'dir-move', status: 'skipped', detail: `~/${PROKOPAI_DIR_NAME} already exists` });
  } else if (!existsSync(legacyHome)) {
    steps.push({ step: 'dir-move', status: 'skipped', detail: 'no legacy directory' });
  } else {
    try {
      renameSync(legacyHome, canonicalHome);
      steps.push({ step: 'dir-move', status: 'done', detail: `moved ${legacyHome} to ${canonicalHome}` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ step: 'dir-move', status: 'failed', detail: message });
      return { success: false, error: `directory move failed: ${message}`, steps };
    }
  }

  // The data dir resolution now sees the canonical dir (or was already
  // canonical / overridden). Resolve fresh: getDataDir() consults the env
  // override first, then the (possibly just-moved) default.
  const dataDir = getDataDir();

  // Step 2: .env keys inside the data dir.
  steps.push(migrateEnvFileKeys());

  // Step 3: agent home .jean2 dirs.
  steps.push(migrateAgentHomeDirs(dataDir));

  // Step 4: workspace rows.
  steps.push(migrateWorkspacePaths(dataDir));

  const failed = steps.filter((s) => s.status === 'failed');
  return {
    success: failed.length === 0,
    error: failed.length > 0 ? failed.map((s) => `${s.step}: ${s.detail}`).join('; ') : undefined,
    steps,
  };
}
