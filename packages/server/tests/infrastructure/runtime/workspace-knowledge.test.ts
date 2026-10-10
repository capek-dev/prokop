import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import {
  resolveWorkspaceMemoryDir,
  resolveWorkspaceSkillsDir,
  workspaceKnowledgeRoot,
} from '@/infrastructure/runtime/workspace-dirs';
import { prokopCompatibilityBindings } from '@/harnesses/prokop/composition/bindings';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

let base: string;
let main: string;
let worktree: string;

beforeEach(() => {
  setupTestDatabase();
  base = mkdtempSync(join(tmpdir(), 'workspace-knowledge-'));
  main = join(base, 'project');
  worktree = join(base, 'worktrees', 'feature');
  mkdirSync(main, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  seedWorkspace({ id: 'ws1', path: main });
  createManagedWorktreeRepository(getDatabase).create({
    id: 'worktree-1', name: 'feature', workspaceId: 'ws1', repositoryId: 'repository-1',
    repositoryRoot: join(main, '.git'), path: worktree, branch: 'feature', head: 'abc123',
    state: 'available', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  resetTestDatabase();
  rmSync(base, { recursive: true, force: true });
});

test('a worktree shares memory and skills with its main workspace', () => {
  expect(workspaceKnowledgeRoot(worktree)).toBe(main);
  expect(resolveWorkspaceMemoryDir(worktree)).toBe(join(main, '.prokopai'));
  expect(resolveWorkspaceSkillsDir(worktree)).toBe(join(main, '.agents', 'skills'));
  // The Prokop harness reads both through its host layout.
  expect(prokopCompatibilityBindings.layout.workspaceMemoryDir(worktree)).toBe(join(main, '.prokopai'));
  expect(prokopCompatibilityBindings.layout.workspaceSkillsDir(worktree)).toBe(join(main, '.agents', 'skills'));
});

test('the main workspace keeps its legacy .jean2 memory for worktree sessions', () => {
  mkdirSync(join(main, '.jean2'));
  expect(resolveWorkspaceMemoryDir(worktree)).toBe(join(main, '.jean2'));
});

test('a worktree reached through a symlink or by its resolved path still maps to its workspace', () => {
  const link = join(base, 'link');
  symlinkSync(worktree, link);
  expect(workspaceKnowledgeRoot(link)).toBe(main);
  // CLI harnesses run in realpathSync(worktree.path).
  expect(workspaceKnowledgeRoot(realpathSync(worktree))).toBe(main);
});

test('other folders are their own knowledge root', () => {
  expect(workspaceKnowledgeRoot(main)).toBe(main);
  const other = join(base, 'other');
  expect(resolveWorkspaceMemoryDir(other)).toBe(join(other, '.prokopai'));
  expect(resolveWorkspaceSkillsDir(other)).toBe(join(other, '.agents', 'skills'));
});
