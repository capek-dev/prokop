import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureConnection } from '@/infrastructure/sqlite/database';
import { getDataDir } from '@/infrastructure/runtime/paths';

describe('SQLite connection configuration', () => {
  test('a write waits for another process to release its lock', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'busy-timeout-'));
    const path = join(dir, 'agent.db');
    const db = new Database(path);
    try {
      configureConnection(db);
      db.run('CREATE TABLE t (v INTEGER)');
      // Another process holds the write lock for 300ms, like a stray sqlite3 or test run.
      const holder = Bun.spawn(['bun', '-e', `
        const { Database } = require('bun:sqlite');
        const db = new Database(${JSON.stringify(path)});
        db.run('BEGIN IMMEDIATE');
        db.run('INSERT INTO t VALUES (1)');
        console.log('locked');
        Bun.sleepSync(300);
        db.run('COMMIT');
      `], { stdout: 'pipe' });
      const reader = holder.stdout.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('locked');

      db.run('INSERT INTO t VALUES (2)');

      expect(await holder.exited).toBe(0);
      expect(db.query('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 2 });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tests never resolve the real data root', () => {
    expect(getDataDir()).not.toBe(join(homedir(), '.prokopai'));
    expect(getDataDir().startsWith(tmpdir())).toBe(true);
  });
});
