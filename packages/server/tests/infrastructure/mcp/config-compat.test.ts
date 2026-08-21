import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadMcpConfig } from '@/infrastructure/mcp/config';
import { PROKOPAI_DIR_NAME, LEGACY_JEAN2_DIR_NAME } from '@/infrastructure/runtime/paths';
import { resetWorkspaceDirWarnings } from '@/infrastructure/runtime/workspace-dirs';

describe('mcp config workspace-dir fallback', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prokopai-mcp-'));
    resetWorkspaceDirWarnings();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('reads .prokopai/mcp.json when present', async () => {
    mkdirSync(join(root, PROKOPAI_DIR_NAME));
    writeFileSync(
      join(root, PROKOPAI_DIR_NAME, 'mcp.json'),
      JSON.stringify({ servers: { canonical: { type: 'local', command: 'echo' } } }),
    );

    const config = await loadMcpConfig(root);
    expect(config.servers.canonical).toBeDefined();
  });

  test('falls back to .jean2/mcp.json when only legacy exists', async () => {
    mkdirSync(join(root, LEGACY_JEAN2_DIR_NAME));
    writeFileSync(
      join(root, LEGACY_JEAN2_DIR_NAME, 'mcp.json'),
      JSON.stringify({ servers: { legacy: { type: 'local', command: 'echo' } } }),
    );

    const config = await loadMcpConfig(root);
    expect(config.servers.legacy).toBeDefined();
  });

  test('canonical wins when both exist', async () => {
    mkdirSync(join(root, PROKOPAI_DIR_NAME));
    mkdirSync(join(root, LEGACY_JEAN2_DIR_NAME));
    writeFileSync(
      join(root, PROKOPAI_DIR_NAME, 'mcp.json'),
      JSON.stringify({ servers: { fromCanonical: { type: 'local', command: 'echo' } } }),
    );
    writeFileSync(
      join(root, LEGACY_JEAN2_DIR_NAME, 'mcp.json'),
      JSON.stringify({ servers: { fromLegacy: { type: 'local', command: 'echo' } } }),
    );

    const config = await loadMcpConfig(root);
    expect(config.servers.fromCanonical).toBeDefined();
    expect(config.servers.fromLegacy).toBeUndefined();
  });

  test('returns empty servers when neither exists', async () => {
    const config = await loadMcpConfig(root);
    expect(config.servers).toEqual({});
  });
});
