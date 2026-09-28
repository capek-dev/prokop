import type { Database } from 'bun:sqlite';

/** Widen the existing CHECK without renaming the referenced sessions table. */
export function widenSessionHarnessConstraint(db: Database): void {
  const row = db.query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get();
  if (!row || row.sql.includes("'claude-cli'")) return;
  const oldCheck = "CHECK (harness IN ('prokop', 'codex-cli'))";
  if (!row.sql.includes(oldCheck)) throw new Error('Unknown sessions harness schema');
  const definition = row.sql.replace(/^CREATE TABLE(?: IF NOT EXISTS)?\s+sessions\s*\(/i,
    'CREATE TABLE sessions_claude_migration (').replace(oldCheck,
    "CHECK (harness IN ('prokop', 'codex-cli', 'claude-cli'))");
  if (definition === row.sql || !definition.startsWith('CREATE TABLE sessions_claude_migration (')) {
    throw new Error('Cannot migrate sessions harness schema');
  }
  const objects = db.query<{ sql: string }, []>(`SELECT sql FROM sqlite_master
    WHERE tbl_name = 'sessions' AND type IN ('index', 'trigger') AND sql IS NOT NULL`).all();
  const columns = db.query<{ name: string; hidden: number }, []>('PRAGMA table_xinfo(sessions)').all()
    .filter(column => column.hidden === 0);
  if (!columns.every(column => /^[a-z_]+$/.test(column.name))) throw new Error('Unexpected sessions column');
  const names = columns.map(column => column.name).join(', ');
  // SQLite only permits changing foreign_keys outside a transaction. Preserve existing child rows,
  // indexes and triggers; validate foreign keys before re-enabling enforcement.
  const foreignKeys = db.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys === 1;
  if (foreignKeys) db.run('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.run(definition);
      db.run(`INSERT INTO sessions_claude_migration (${names}) SELECT ${names} FROM sessions`);
      db.run('DROP TABLE sessions');
      db.run('ALTER TABLE sessions_claude_migration RENAME TO sessions');
      for (const object of objects) db.run(object.sql);
      const invalid = db.query('PRAGMA foreign_key_check').get();
      if (invalid) throw new Error('Sessions migration violates foreign keys');
    })();
  } finally {
    if (foreignKeys) db.run('PRAGMA foreign_keys = ON');
  }
}
