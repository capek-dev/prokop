/**
 * Infrastructure sqlite: workspace-path rewrite for the jean2 → prokopai
 * rename migration. Owns direct database access; the CLI orchestrates.
 */

import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { LEGACY_JEAN2_DIR_NAME, PROKOPAI_DIR_NAME } from '@/infrastructure/runtime/paths';

export interface WorkspacePathRewriteResult {
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

/**
 * Rewrite workspaces.path rows pointing under the legacy home data dir
 * (~/.jean2/...) to the canonical one (~/.prokopai/...). Rows outside the
 * legacy prefix are untouched. Idempotent: a second run finds no rows.
 */
export function rewriteWorkspacePathsForRename(databasePath: string): WorkspacePathRewriteResult {
  if (!existsSync(databasePath)) {
    return { status: 'skipped', detail: 'no database file' };
  }

  const legacyPrefix = join(homedir(), LEGACY_JEAN2_DIR_NAME);
  const canonicalPrefix = join(homedir(), PROKOPAI_DIR_NAME);

  let db: Database | undefined;
  try {
    db = new Database(databasePath);
    const rows = db
      .query('SELECT id, path FROM workspaces WHERE path LIKE ?')
      .all(`${legacyPrefix}%`) as Array<{ id: string; path: string }>;

    if (rows.length === 0) {
      return { status: 'skipped', detail: 'no legacy-prefixed rows' };
    }

    const update = db.query('UPDATE workspaces SET path = ? WHERE id = ?');
    let updated = 0;
    for (const row of rows) {
      const newPath = canonicalPrefix + row.path.slice(legacyPrefix.length);
      update.run(newPath, row.id);
      updated++;
    }
    return { status: 'done', detail: `rewrote ${updated} rows` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', detail: message };
  } finally {
    db?.close();
  }
}
