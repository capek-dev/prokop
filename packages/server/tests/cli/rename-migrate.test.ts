import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { runProkopaiRenameMigration } from '@/cli/rename-migrate';
import { Paths, PROKOPAI_DIR_NAME, LEGACY_JEAN2_DIR_NAME } from '@/infrastructure/runtime/paths';

// The real migration targets the real homedir; tests must not touch it. We
// verify the step functions against temp dirs by driving the module through
// Paths.configure (dataDir) and a scratch db, with the dir-move step skipped
// (it only acts on the actual home).
describe('prokopai rename migration', () => {
  let dataDir: string;
  const savedDbPath = process.env.PROKOPAI_DATABASE_PATH;
  const savedLegacyDbPath = process.env.JEAN2_DATABASE_PATH;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'prokopai-migrate-'));
    Paths.configure({ dataDir });
    // Pin the db path to the scratch dir: other suites may leave
    // JEAN2_DATABASE_PATH set, which would redirect the workspace-path step.
    delete process.env.PROKOPAI_DATABASE_PATH;
    delete process.env.JEAN2_DATABASE_PATH;
  });

  afterEach(() => {
    Paths.reset();
    if (savedDbPath === undefined) delete process.env.PROKOPAI_DATABASE_PATH;
    else process.env.PROKOPAI_DATABASE_PATH = savedDbPath;
    if (savedLegacyDbPath === undefined) delete process.env.JEAN2_DATABASE_PATH;
    else process.env.JEAN2_DATABASE_PATH = savedLegacyDbPath;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test('rewrites JEAN2_* keys in .env, preserving comments and other lines', () => {
    writeFileSync(
      join(dataDir, '.env'),
      '# comment stays\nJEAN2_LLM_OPENAI_API_KEY=old-key\nOTHER_VAR=untouched\nJEAN2_PORT=9000\n',
    );

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    const envStep = result.steps.find((s) => s.step === 'env-keys');
    expect(envStep?.status).toBe('done');

    const content = readFileSync(join(dataDir, '.env'), 'utf-8');
    expect(content).toContain('PROKOPAI_LLM_OPENAI_API_KEY=old-key');
    expect(content).toContain('PROKOPAI_PORT=9000');
    expect(content).toContain('# comment stays');
    expect(content).toContain('OTHER_VAR=untouched');
    expect(content).not.toContain('JEAN2_');
  });

  test('renames agent home .jean2 dirs to .prokopai', () => {
    mkdirSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME), { recursive: true });
    writeFileSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME, 'USER.md'), '- pref');

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    const homesStep = result.steps.find((s) => s.step === 'agent-homes');
    expect(homesStep?.status).toBe('done');
    const newPath = join(dataDir, 'agents', 'coder', 'home', PROKOPAI_DIR_NAME);
    expect(existsSync(newPath)).toBe(true);
    expect(readFileSync(join(newPath, 'USER.md'), 'utf-8')).toBe('- pref');
    expect(existsSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME))).toBe(false);
  });

  test('leaves agent home .jean2 untouched when canonical already exists', () => {
    mkdirSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME), { recursive: true });
    mkdirSync(join(dataDir, 'agents', 'coder', 'home', PROKOPAI_DIR_NAME));

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    expect(existsSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME))).toBe(true);
    const homesStep = result.steps.find((s) => s.step === 'agent-homes');
    expect(homesStep?.detail).toContain('canonical exists');
  });

  test('rewrites workspace rows prefixed with the legacy home dir', () => {
    const dbDir = join(dataDir, 'data');
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, 'agent.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, is_virtual INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const legacyHome = join(homedir(), LEGACY_JEAN2_DIR_NAME);
    const canonicalHome = join(homedir(), PROKOPAI_DIR_NAME);
    db.run('INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['ws1', 'inside', join(legacyHome, 'workspaces', 'abc'), '2024-01-01', '2024-01-01']);
    db.run('INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['ws2', 'outside', '/Users/someone/projects/app', '2024-01-01', '2024-01-01']);
    db.close();

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    const pathsStep = result.steps.find((s) => s.step === 'workspace-paths');
    expect(pathsStep?.status).toBe('done');

    const verify = new Database(dbPath);
    const ws1 = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws1') as { path: string };
    const ws2 = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws2') as { path: string };
    verify.close();
    expect(ws1.path).toBe(join(canonicalHome, 'workspaces', 'abc'));
    expect(ws2.path).toBe('/Users/someone/projects/app');
  });

  test('is idempotent: second run has nothing to do', () => {
    writeFileSync(join(dataDir, '.env'), 'JEAN2_LLM_OPENAI_API_KEY=key\n');
    mkdirSync(join(dataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME), { recursive: true });

    const first = runProkopaiRenameMigration({ skipDirMove: true });
    expect(first.success).toBe(true);

    const second = runProkopaiRenameMigration({ skipDirMove: true });
    expect(second.success).toBe(true);
    expect(second.steps.find((s) => s.step === 'env-keys')?.status).toBe('skipped');
    expect(second.steps.find((s) => s.step === 'agent-homes')?.status).toBe('skipped');
    expect(second.steps.find((s) => s.step === 'workspace-paths')?.status).toBe('skipped');
  });

  test('no-op on a fresh prokopai install reports all skipped', () => {
    const result = runProkopaiRenameMigration({ skipDirMove: true });
    expect(result.success).toBe(true);
    expect(result.steps.every((s) => s.status === 'skipped')).toBe(true);
  });
});
