import { Database } from 'bun:sqlite';
import { createRuntime } from '@/bootstrap/create-runtime';
import { initializeSchema, DB } from '@/infrastructure/sqlite/database';

/**
 * Create a fresh in-memory SQLite database with full schema initialized.
 * Each call returns a new, isolated DB — no cross-test contamination.
 *
 * Usage:
 *   const db = createTestDatabase();
 *   // ... use store functions that call getDatabase() ...
 *   db.close();
 */
export function createTestDatabase(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

/**
 * Set up an in-memory database as the active store singleton.
 * Call this in beforeEach(). Call resetTestDatabase() in afterEach().
 *
 * Usage:
 *   beforeEach(() => setupTestDatabase());
 *   afterEach(() => resetTestDatabase());
 */
export function setupTestDatabase(): Database {
  createRuntime();
  const db = createTestDatabase();
  DB.configure({ database: db });
  return db;
}

/**
 * Tear down the test database override.
 * Call this in afterEach() to prevent leaks.
 */
export function resetTestDatabase(): void {
  DB.reset();
}
