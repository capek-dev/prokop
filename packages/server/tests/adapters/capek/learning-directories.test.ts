import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Workspace } from '@prokopai/sdk';
import { createLearningDirectoryResolver } from '@/adapters/capek/learning-directories';

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

async function fixture() {
  root = await mkdtemp(join(await realpath(tmpdir()), 'learning-dirs-'));
  return root;
}

test('workspace memory uses canonical or existing legacy directory without forking', async () => {
  const path = await fixture();
  const resolve = createLearningDirectoryResolver({ getAgentDirectory: async () => null });
  const workspace = { id: 'ws', path, settings: {} } as Workspace;
  expect(await resolve(workspace)).toEqual({ memoryDirectory: join(path, '.prokopai'), skillsDirectory: join(path, '.agents/skills') });
  await mkdir(join(path, '.jean2'));
  expect((await resolve(workspace)).memoryDirectory).toBe(join(path, '.jean2'));
  await mkdir(join(path, '.prokopai'));
  expect((await resolve(workspace)).memoryDirectory).toBe(join(path, '.prokopai'));
});

test('personal learning targets the owning agent root, not workspace memory', async () => {
  const directory = await fixture();
  const resolve = createLearningDirectoryResolver({ getAgentDirectory: async id => id === 'dev' ? directory : null });
  const workspace = { id: 'dev-home', path: join(directory, 'home'), settings: { isAgentHome: true, agentId: 'dev' } } as Workspace;
  expect(await resolve(workspace)).toEqual({ memoryDirectory: directory, skillsDirectory: join(directory, 'skills') });
  await expect(resolve({ ...workspace, id: 'other' })).rejects.toThrow('identity');
  await expect(resolve({ ...workspace, path: join(directory, 'other') })).rejects.toThrow('unavailable');
  await expect(resolve({ ...workspace, settings: { isAgentHome: true, agentId: '../dev' } })).rejects.toThrow('identity');
});
