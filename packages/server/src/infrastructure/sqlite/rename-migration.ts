import { closeSync, existsSync, openSync, readSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { Database } from 'bun:sqlite';

export interface WorkspacePathRewriteResult {
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

export interface DatabaseValidationResult {
  success: boolean;
  detail: string;
  fingerprint?: string;
}

function hasTable(db: Database, table: string): boolean {
  return db
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) !== null;
}

function legacyPathRows(
  db: Database,
  table: 'workspaces' | 'workspace_paths',
  legacyPrefix: string,
): Array<{ rowid: number; path: string }> {
  const slashPrefix = `${legacyPrefix}/`;
  const backslashPrefix = `${legacyPrefix}\\`;
  return db
    .query(`SELECT rowid, path FROM ${table} WHERE path = ? OR substr(path, 1, length(?)) = ? OR substr(path, 1, length(?)) = ?`)
    .all(legacyPrefix, slashPrefix, slashPrefix, backslashPrefix, backslashPrefix) as Array<{ rowid: number; path: string }>;
}

export function rewriteWorkspacePathsForRename(
  databasePath: string,
  legacyPrefix: string,
  canonicalPrefix: string,
): WorkspacePathRewriteResult {
  if (!existsSync(databasePath)) {
    return { status: 'failed', detail: `database file not found: ${databasePath}` };
  }

  let db: Database | undefined;
  try {
    db = new Database(databasePath);
    const tables = (['workspaces', 'workspace_paths'] as const).filter((table) => hasTable(db!, table));
    const rows = tables.flatMap((table) => legacyPathRows(db!, table, legacyPrefix).map((row) => ({ table, ...row })));

    if (rows.length === 0) {
      return { status: 'skipped', detail: 'no legacy-prefixed rows' };
    }

    db.run('BEGIN IMMEDIATE');
    try {
      for (const row of rows) {
        const newPath = canonicalPrefix + row.path.slice(legacyPrefix.length);
        db.query(`UPDATE ${row.table} SET path = ? WHERE rowid = ?`).run(newPath, row.rowid);
      }
      db.run('COMMIT');
    } catch (err: unknown) {
      db.run('ROLLBACK');
      throw err;
    }

    return { status: 'done', detail: `rewrote ${rows.length} rows` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', detail: message };
  } finally {
    db?.close();
  }
}

export function checkpointDatabase(databasePath: string): DatabaseValidationResult {
  if (!existsSync(databasePath)) {
    return { success: false, detail: `database file not found: ${databasePath}` };
  }

  let db: Database | undefined;
  try {
    db = new Database(databasePath);
    const result = db.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
      busy?: number;
      log?: number;
      checkpointed?: number;
    } | null;
    if (result?.busy || (result?.log !== undefined && result.log > 0)) {
      return {
        success: false,
        detail: 'database WAL could not be fully checkpointed; stop every Prokop or Jean2 process and retry',
      };
    }
    return { success: true, detail: 'database checkpoint completed' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, detail: message };
  } finally {
    db?.close();
  }
}

function hashFile(filePath: string): string {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(filePath, 'r');
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function validateDatabase(databasePath: string): DatabaseValidationResult {
  if (!existsSync(databasePath)) {
    return { success: false, detail: `database file not found: ${databasePath}` };
  }
  if (statSync(databasePath).size === 0) {
    return { success: false, detail: `database file is empty: ${databasePath}` };
  }

  let db: Database | undefined;
  try {
    db = new Database(databasePath, { readonly: true });
    const rows = db.query('PRAGMA integrity_check').all() as Array<Record<string, string>>;
    const results = rows.flatMap((row) => Object.values(row));
    if (results.length !== 1 || results[0] !== 'ok') {
      return { success: false, detail: `database integrity check failed: ${results.join('; ')}` };
    }
    db.close();
    db = undefined;
    return {
      success: true,
      detail: 'database integrity check passed',
      fingerprint: hashFile(databasePath),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, detail: message };
  } finally {
    db?.close();
  }
}
