import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { Database } from 'bun:sqlite';
import { runProkopaiRenameMigration } from '@/cli/rename-migrate';
import { resolveDatabasePath } from '@/config';
import { Paths, PROKOPAI_DIR_NAME, LEGACY_JEAN2_DIR_NAME } from '@/infrastructure/runtime/paths';

// The real migration targets the real homedir; tests must not touch it. We
// verify the step functions against temp dirs by driving the module through
// Paths.configure (dataDir) and a scratch db, with the dir-move step skipped
// (it only acts on the actual home).
describe('prokop legacy data migration', () => {
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
    const legacyHome = join(homedir(), LEGACY_JEAN2_DIR_NAME);
    const canonicalHome = join(homedir(), PROKOPAI_DIR_NAME);
    writeFileSync(
      join(dataDir, '.env'),
      `# comment stays\nJEAN2_LLM_OPENAI_API_KEY=old-key\nOTHER_VAR=untouched\nJEAN2_PORT=9000\nJEAN2_DATABASE_PATH="${legacyHome}/data/agent.db"\nPROKOPAI_TOOLS_PATH=${legacyHome}/tools\n`,
    );

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    const envStep = result.steps.find((s) => s.step === 'env-keys');
    expect(envStep?.status).toBe('done');

    const content = readFileSync(join(dataDir, '.env'), 'utf-8');
    expect(content).toContain('PROKOPAI_LLM_OPENAI_API_KEY=old-key');
    expect(content).toContain('PROKOPAI_PORT=9000');
    expect(content).toContain(`PROKOPAI_DATABASE_PATH="${canonicalHome}/data/agent.db"`);
    expect(content).toContain(`PROKOPAI_TOOLS_PATH=${canonicalHome}/tools`);
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
    db.run('CREATE TABLE workspace_paths (workspace_id TEXT NOT NULL, path TEXT NOT NULL, PRIMARY KEY (workspace_id, path))');
    const legacyHome = join(homedir(), LEGACY_JEAN2_DIR_NAME);
    const canonicalHome = join(homedir(), PROKOPAI_DIR_NAME);
    db.run('INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['ws1', 'inside', join(legacyHome, 'workspaces', 'abc'), '2024-01-01', '2024-01-01']);
    db.run('INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['ws2', 'outside', '/Users/someone/projects/app', '2024-01-01', '2024-01-01']);
    db.run('INSERT INTO workspaces (id, name, path, is_virtual, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
      ['ws3', 'sibling', `${legacyHome}-backup/workspaces/abc`, '2024-01-01', '2024-01-01']);
    db.run('INSERT INTO workspace_paths (workspace_id, path) VALUES (?, ?)',
      ['ws1', join(legacyHome, 'additional', 'abc')]);
    db.close();

    const result = runProkopaiRenameMigration({ skipDirMove: true });

    const pathsStep = result.steps.find((s) => s.step === 'workspace-paths');
    expect(pathsStep?.status).toBe('done');

    const verify = new Database(dbPath);
    const ws1 = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws1') as { path: string };
    const ws2 = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws2') as { path: string };
    const ws3 = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws3') as { path: string };
    const additional = verify.query('SELECT path FROM workspace_paths WHERE workspace_id = ?').get('ws1') as { path: string };
    verify.close();
    expect(ws1.path).toBe(join(canonicalHome, 'workspaces', 'abc'));
    expect(ws2.path).toBe('/Users/someone/projects/app');
    expect(ws3.path).toBe(`${legacyHome}-backup/workspaces/abc`);
    expect(additional.path).toBe(join(canonicalHome, 'additional', 'abc'));
  });

  test('moves legacy data before migrating nested homes and workspace paths', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    const legacyAgentHome = join(legacyDataDir, 'agents', 'coder', 'home', LEGACY_JEAN2_DIR_NAME);
    const legacyDbPath = join(legacyDataDir, 'data', 'agent.db');
    mkdirSync(legacyAgentHome, { recursive: true });
    mkdirSync(join(legacyDataDir, 'data'), { recursive: true });
    writeFileSync(join(legacyAgentHome, 'USER.md'), '- pref');
    writeFileSync(
      join(legacyDataDir, '.env'),
      `JEAN2_DATABASE_PATH=${legacyDbPath}\n`,
    );

    const db = new Database(legacyDbPath);
    db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL)');
    db.run('INSERT INTO workspaces (id, path) VALUES (?, ?)', [
      'ws1',
      join(legacyDataDir, 'workspaces', 'abc'),
    ]);
    db.close();
    writeFileSync(join(legacyDataDir, 'config.json'), JSON.stringify({
      databasePath: legacyDbPath,
      toolsPath: join(legacyDataDir, 'tools'),
      port: 8742,
      host: '0.0.0.0',
      initializedAt: '2024-01-01T00:00:00.000Z',
    }));

    const result = runProkopaiRenameMigration({
      legacyDataDir,
      canonicalDataDir,
      timestamp: 'test',
    });

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.step === 'stage')?.status).toBe('done');
    expect(result.steps.find((step) => step.step === 'startup-validation')?.status).toBe('done');
    expect(existsSync(legacyDataDir)).toBe(false);
    const backupPath = `${legacyDataDir}.pre-prokop-migration-test`;
    expect(existsSync(backupPath)).toBe(true);
    const backupConfig = JSON.parse(readFileSync(join(backupPath, 'config.json'), 'utf-8')) as { databasePath: string };
    expect(backupConfig.databasePath).toBe(legacyDbPath);
    expect(existsSync(join(canonicalDataDir, 'agents', 'coder', 'home', PROKOPAI_DIR_NAME))).toBe(true);
    expect(readFileSync(join(canonicalDataDir, '.env'), 'utf-8')).toBe(
      `PROKOPAI_DATABASE_PATH=${join(canonicalDataDir, 'data', 'agent.db')}\n`,
    );

    const verify = new Database(join(canonicalDataDir, 'data', 'agent.db'));
    const workspace = verify.query('SELECT path FROM workspaces WHERE id = ?').get('ws1') as { path: string };
    verify.close();
    expect(workspace.path).toBe(join(canonicalDataDir, 'workspaces', 'abc'));
  });

  test('rewrites config paths so startup opens the moved database', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    const legacyDbPath = join(legacyDataDir, 'data', 'agent.db');
    mkdirSync(join(legacyDataDir, 'data'), { recursive: true });

    const db = new Database(legacyDbPath);
    db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL)');
    db.run('INSERT INTO workspaces (id, path) VALUES (?, ?)', ['existing', '/project']);
    db.close();

    writeFileSync(join(legacyDataDir, 'config.json'), JSON.stringify({
      databasePath: legacyDbPath,
      toolsPath: join(legacyDataDir, 'tools'),
      port: 8742,
      host: '0.0.0.0',
      initializedAt: '2024-01-01T00:00:00.000Z',
    }));

    const result = runProkopaiRenameMigration({
      legacyDataDir,
      canonicalDataDir,
      timestamp: 'startup-test',
    });

    expect(result.success).toBe(true);
    expect(result.steps.find((step) => step.step === 'config-paths')).toEqual({
      step: 'config-paths',
      status: 'done',
      detail: 'rewrote 2 paths',
    });

    Paths.configure({ dataDir: canonicalDataDir });
    const resolvedDbPath = resolveDatabasePath();
    expect(resolvedDbPath).toBe(join(canonicalDataDir, 'data', 'agent.db'));

    const verify = new Database(resolvedDbPath, { readonly: true });
    const row = verify.query('SELECT id FROM workspaces WHERE id = ?').get('existing') as { id: string };
    verify.close();
    expect(row.id).toBe('existing');
    expect(result.backupPath).toBe(`${legacyDataDir}.pre-prokop-migration-startup-test`);
    expect(existsSync(result.backupPath!)).toBe(true);
  });

  test('repairs a canonical directory with stale legacy config paths', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    const legacyDbPath = join(legacyDataDir, 'data', 'agent.db');
    const canonicalDbPath = join(canonicalDataDir, 'data', 'agent.db');
    mkdirSync(join(canonicalDataDir, 'data'), { recursive: true });

    const db = new Database(canonicalDbPath);
    db.run('CREATE TABLE workspaces (id TEXT PRIMARY KEY, path TEXT NOT NULL)');
    db.run('INSERT INTO workspaces (id, path) VALUES (?, ?)', ['existing', '/project']);
    db.close();
    writeFileSync(join(canonicalDataDir, 'config.json'), JSON.stringify({
      databasePath: legacyDbPath,
      toolsPath: join(legacyDataDir, 'tools'),
      port: 8742,
      host: '0.0.0.0',
    }));

    const result = runProkopaiRenameMigration({
      legacyDataDir,
      canonicalDataDir,
      timestamp: 'repair-test',
    });

    expect(result.success).toBe(true);
    expect(result.backupPath).toBe(`${canonicalDataDir}.pre-prokop-repair-repair-test`);
    expect(existsSync(result.backupPath!)).toBe(true);
    const repairedConfig = JSON.parse(readFileSync(join(canonicalDataDir, 'config.json'), 'utf-8')) as {
      databasePath: string;
      toolsPath: string;
    };
    expect(repairedConfig.databasePath).toBe(canonicalDbPath);
    expect(repairedConfig.toolsPath).toBe(join(canonicalDataDir, 'tools'));
    const verify = new Database(canonicalDbPath, { readonly: true });
    const row = verify.query('SELECT id FROM workspaces WHERE id = ?').get('existing') as { id: string };
    verify.close();
    expect(row.id).toBe('existing');
  });

  test('fails before copying a corrupt source database', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    const legacyDbPath = join(legacyDataDir, 'data', 'agent.db');
    mkdirSync(join(legacyDataDir, 'data'), { recursive: true });
    writeFileSync(legacyDbPath, 'not a sqlite database');
    writeFileSync(join(legacyDataDir, 'config.json'), JSON.stringify({
      databasePath: legacyDbPath,
      toolsPath: join(legacyDataDir, 'tools'),
    }));

    const result = runProkopaiRenameMigration({ legacyDataDir, canonicalDataDir });

    expect(result.success).toBe(false);
    expect(existsSync(legacyDataDir)).toBe(true);
    expect(existsSync(canonicalDataDir)).toBe(false);
    expect(existsSync(`${canonicalDataDir}.migration-staging`)).toBe(false);
  });

  test('fails safely when legacy and canonical data directories both exist', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    mkdirSync(legacyDataDir);
    mkdirSync(canonicalDataDir);

    const result = runProkopaiRenameMigration({ legacyDataDir, canonicalDataDir });

    expect(result.success).toBe(false);
    expect(result.steps.at(-1)).toEqual({
      step: 'preflight',
      status: 'failed',
      detail: `${legacyDataDir} and ${canonicalDataDir} both exist; neither was changed`,
    });
    expect(existsSync(legacyDataDir)).toBe(true);
    expect(existsSync(canonicalDataDir)).toBe(true);
  });

  test('rejects data directory values that route startup elsewhere', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    mkdirSync(legacyDataDir);
    writeFileSync(join(legacyDataDir, '.env'), 'JEAN2_DATA_DIR=/tmp/unrelated-data\n');

    const result = runProkopaiRenameMigration({ legacyDataDir, canonicalDataDir });

    expect(result.success).toBe(false);
    expect(result.error).toContain('data-directory overrides');
    expect(existsSync(legacyDataDir)).toBe(true);
    expect(existsSync(canonicalDataDir)).toBe(false);
  });

  test('rejects path environment overrides before touching data', () => {
    const legacyDataDir = join(dataDir, LEGACY_JEAN2_DIR_NAME);
    const canonicalDataDir = join(dataDir, PROKOPAI_DIR_NAME);
    mkdirSync(legacyDataDir);
    process.env.JEAN2_DATABASE_PATH = join(legacyDataDir, 'data', 'agent.db');

    const result = runProkopaiRenameMigration({ legacyDataDir, canonicalDataDir });

    expect(result.success).toBe(false);
    expect(result.steps[0]?.step).toBe('preflight');
    expect(existsSync(legacyDataDir)).toBe(true);
    expect(existsSync(canonicalDataDir)).toBe(false);
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

  test('no-op on a fresh prokop install reports all skipped', () => {
    const result = runProkopaiRenameMigration({ skipDirMove: true });
    expect(result.success).toBe(true);
    expect(result.steps.every((s) => s.status === 'skipped')).toBe(true);
  });
});
