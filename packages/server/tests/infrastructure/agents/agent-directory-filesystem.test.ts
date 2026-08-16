import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentDirectoryPort } from '@/infrastructure/agents/agent-directory-filesystem';
import type { AgentDirectoryPort } from '@/application/ports/agents';

const roots: string[] = [];

async function tempDir(label: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), `jean2-agents-infra-${label}-`));
  roots.push(path);
  return path;
}

afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});

describe('agent directory filesystem adapter', () => {
  let port: AgentDirectoryPort;
  let root: string;

  beforeEach(async () => {
    root = await tempDir('fs');
    port = createAgentDirectoryPort();
  });

  test('exists reflects files and directories', async () => {
    expect(port.exists(root)).toBe(true);
    expect(port.exists(join(root, 'missing'))).toBe(false);
    await port.makeDirectories(join(root, 'nested', 'deeper'));
    expect(port.exists(join(root, 'nested', 'deeper'))).toBe(true);
  });

  test('lists only directories', async () => {
    await port.makeDirectories(join(root, 'a'), join(root, 'b'));
    await port.writeFile(join(root, 'file.txt'), 'x');
    expect((await port.listDirectories(root)).sort()).toEqual(['a', 'b']);
  });

  test('reads, writes, and reports missing files', async () => {
    await port.writeFile(join(root, 'USER.md'), '- pref');
    expect(await port.readFileOrNull(join(root, 'USER.md'))).toBe('- pref');
    expect(await port.readFileOrNull(join(root, 'missing.md'))).toBeNull();
  });

  test('removes directories recursively', async () => {
    await port.makeDirectories(join(root, 'agent', 'home', '.jean2'));
    await port.writeFile(join(root, 'agent', 'MEMORY.md'), 'x');
    await port.removeRecursive(join(root, 'agent'));
    expect(port.exists(join(root, 'agent'))).toBe(false);
  });

  test('statBirthtimeIso returns an ISO birthtime string', async () => {
    await port.makeDirectories(join(root, 'agent'));
    const createdAt = await port.statBirthtimeIso(join(root, 'agent'));
    expect(new Date(createdAt).toISOString()).toBe(createdAt);
  });
});
