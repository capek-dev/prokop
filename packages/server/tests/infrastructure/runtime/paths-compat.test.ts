import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Paths, PROKOPAI_DIR_NAME, LEGACY_JEAN2_DIR_NAME } from '@/infrastructure/runtime/paths';
import { resolveWorkspaceDir, resetWorkspaceDirWarnings } from '@/infrastructure/runtime/workspace-dirs';

// Paths default resolution reads the real homedir; these tests exercise the
// resolution rule through Paths.configure overrides and the shared resolve
// helpers against temp dirs, avoiding touching the user's actual home.
describe('paths compat resolution', () => {
  const savedDataDir = process.env.PROKOPAI_DATA_DIR;
  const savedLegacyDataDir = process.env.JEAN2_DATA_DIR;

  beforeEach(() => {
    Paths.reset();
    delete process.env.PROKOPAI_DATA_DIR;
    delete process.env.JEAN2_DATA_DIR;
  });

  afterEach(() => {
    Paths.reset();
    if (savedDataDir === undefined) delete process.env.PROKOPAI_DATA_DIR;
    else process.env.PROKOPAI_DATA_DIR = savedDataDir;
    if (savedLegacyDataDir === undefined) delete process.env.JEAN2_DATA_DIR;
    else process.env.JEAN2_DATA_DIR = savedLegacyDataDir;
  });

  test('PROKOPAI_DATA_DIR override wins', () => {
    process.env.PROKOPAI_DATA_DIR = '/tmp/prokopai-override';
    expect(Paths.getDataDir()).toBe('/tmp/prokopai-override');
  });

  test('legacy JEAN2_DATA_DIR still honored when canonical unset', () => {
    process.env.JEAN2_DATA_DIR = '/tmp/jean2-override';
    expect(Paths.getDataDir()).toBe('/tmp/jean2-override');
  });

  test('canonical override beats legacy override', () => {
    process.env.JEAN2_DATA_DIR = '/tmp/jean2-override';
    process.env.PROKOPAI_DATA_DIR = '/tmp/prokopai-override';
    expect(Paths.getDataDir()).toBe('/tmp/prokopai-override');
  });

  test('binary name is prokopai', () => {
    expect(Paths.getBinaryPath().endsWith('prokopai')).toBe(true);
  });
});

describe('workspace dir resolution', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prokopai-ws-'));
    resetWorkspaceDirWarnings();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('canonical .prokopai wins when both exist', () => {
    mkdirSync(join(root, PROKOPAI_DIR_NAME));
    mkdirSync(join(root, LEGACY_JEAN2_DIR_NAME));
    expect(resolveWorkspaceDir(root)).toBe(join(root, PROKOPAI_DIR_NAME));
  });

  test('falls back to .jean2 when only legacy exists', () => {
    mkdirSync(join(root, LEGACY_JEAN2_DIR_NAME));
    expect(resolveWorkspaceDir(root)).toBe(join(root, LEGACY_JEAN2_DIR_NAME));
  });

  test('defaults to .prokopai when neither exists', () => {
    expect(resolveWorkspaceDir(root)).toBe(join(root, PROKOPAI_DIR_NAME));
    expect(existsSync(join(root, PROKOPAI_DIR_NAME))).toBe(false);
  });

  test('legacy fallback warns once per workspace', () => {
    mkdirSync(join(root, LEGACY_JEAN2_DIR_NAME));
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
      resolveWorkspaceDir(root);
      resolveWorkspaceDir(root);
      resolveWorkspaceDir(root);
      expect(warnings.filter((w) => w.includes('legacy workspace directory')).length).toBe(1);
    } finally {
      console.warn = original;
    }
  });
});
