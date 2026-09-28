import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Preconfig } from '@prokopai/sdk';
import { codexAgentSkillTools } from '@/adapters/capek/codex-agent-skills';
import { createCodexAgentSkillTools } from '@/harnesses/codex-cli/agent-skill-tools';
import { formatCodexAgentSkills, listCodexAgentSkills } from '@/harnesses/codex-cli/agent-skills';
import { codexDeveloperInstructions } from '@/harnesses/codex-cli/instructions';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';

const root = mkdtempSync(join(tmpdir(), 'codex-skills-'));
const agentDir = join(root, 'agent');
const workspaceRoot = join(root, 'workspace');
const def = { type: 'function' as const, name: 'agent_skill_manage',
  description: 'Agent skill management', inputSchema: { type: 'object' } };
const bridge = { definitions: () => [def, { ...def, name: 'skill_manage' }],
  execute: codexAgentSkillTools.execute };
const call = (callId: string, args: unknown, overrides: Record<string, unknown> = {}): unknown => ({
  threadId: 'thread', turnId: 'turn', callId, namespace: null,
  tool: 'agent_skill_manage', arguments: args, ...overrides,
});
const result = (value: { contentItems: Array<{ text: string }> }): Record<string, unknown> =>
  JSON.parse(value.contentItems[0]!.text) as Record<string, unknown>;
function putSkill(dir: string, name: string, description = name): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`);
}

beforeEach(() => {
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: workspaceRoot });
  createSession({ id: 's', workspaceId: 'ws', title: 'Test', status: 'active',
    preconfigId: 'agent', agentId: 'agent', metadata: null, parentId: null,
    agentName: null, harness: 'codex-cli' });
});
afterEach(() => {
  resetTestDatabase();
  rmSync(agentDir, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

test('agent skill listing respects allowlists, workspace precedence, and path/size bounds', async () => {
  putSkill(join(agentDir, 'skills'), 'shared');
  putSkill(join(agentDir, 'skills'), 'personal', 'Personal procedure');
  putSkill(join(workspaceRoot, '.agents', 'skills'), 'shared');
  const visible = await listCodexAgentSkills(agentDir, workspaceRoot, null);
  expect(visible.map(skill => skill.name)).toEqual(['personal']);
  const text = formatCodexAgentSkills(visible)!;
  expect(text).toContain(join(agentDir, 'skills', 'personal', 'SKILL.md'));
  expect(text).not.toContain('shared');
  expect(await listCodexAgentSkills(agentDir, workspaceRoot, [])).toEqual([]);
  expect(await listCodexAgentSkills(agentDir, workspaceRoot, ['shared'])).toEqual([]);
  expect(await listCodexAgentSkills(null, workspaceRoot, null)).toEqual([]);
  expect(formatCodexAgentSkills([{ name: 'huge', description: 'a'.repeat(9000), path: '/path' }])).toBeNull();
  symlinkSync(join(agentDir, 'skills', 'personal', 'SKILL.md'),
    join(agentDir, 'skills', 'linked'), 'file');
  mkdirSync(join(agentDir, 'skills', 'alias'));
  symlinkSync(join(agentDir, 'skills', 'personal', 'SKILL.md'),
    join(agentDir, 'skills', 'alias', 'SKILL.md'));
  expect((await listCodexAgentSkills(agentDir, workspaceRoot, null)).map(skill => skill.name)).toEqual(['personal']);
});

test('instructions include agent skills only for the selected agent, not plain preconfigs', async () => {
  putSkill(join(agentDir, 'skills'), 'personal', 'Personal procedure');
  const preconfig = { id: 'agent', systemPrompt: 'Act carefully.', skills: null } as Preconfig;
  const workspace = getWorkspace('ws')!;
  const sources = { listPreconfigs: async () => [preconfig], getPreconfig: async () => preconfig,
    getAgentDirectory: async () => agentDir, readAgentMemoryFile: async () => null };
  const text = await codexDeveloperInstructions(workspace, workspaceRoot, preconfig, sources,
    ['agent_skill_manage']);
  expect(text).toContain('<agent_home_skills>');
  expect(text).toContain('personal: Personal procedure');
  expect(text).toContain('Use agent_skill_manage');
  expect(text).not.toContain('workspace skill_manage');
  const plain = await codexDeveloperInstructions(workspace, workspaceRoot, preconfig,
    { ...sources, getAgentDirectory: async () => null }, ['agent_skill_manage']);
  expect(plain).not.toContain('<agent_home_skills>');
  expect(plain).not.toContain('Use agent_skill_manage');
  expect(await codexDeveloperInstructions(workspace, workspaceRoot, { ...preconfig, skills: [] }, sources))
    .not.toContain('<agent_home_skills>');
});

test('manager uses published executor and rejects malformed, duplicate, switched or stale calls', async () => {
  expect(codexAgentSkillTools.definitions().map(item => item.name)).toEqual(['agent_skill_manage']);
  let active = true;
  let validRoot = true;
  const tools = createCodexAgentSkillTools({ bridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir, isActive: turn => active && turn === 'turn',
    authorizeRoot: () => validRoot });
  expect(tools.definitions.map(item => item.name)).toEqual(['agent_skill_manage']);
  const wrongWorkspace = createCodexAgentSkillTools({ bridge, sessionId: 's', workspaceId: 'other',
    preconfigId: 'agent', agentDir, isActive: () => true, authorizeRoot: () => true });
  expect((await wrongWorkspace.call(call('wrong-workspace', { action: 'list' }))).success).toBe(false);
  const plain = createCodexAgentSkillTools({ bridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir: null, isActive: () => true, authorizeRoot: () => true });
  expect(plain.definitions).toEqual([]);
  expect((await plain.call(call('plain', { action: 'list' }))).success).toBe(false);
  expect((await tools.call(call('bad-tool', {}, { tool: 'skill_manage' }))).success).toBe(false);
  expect((await tools.call(call('bad-namespace', {}, { namespace: 'other' }))).success).toBe(false);
  expect((await tools.call(call('bad-action', { action: 'unknown' }))).success).toBe(false);
  expect((await tools.call(call('bad-field', { action: 'list', name: [] }))).success).toBe(false);
  expect((await tools.call(call('bad-turn', { action: 'list' }, { turnId: 'old' }))).success).toBe(false);
  const created = await tools.call(call('create', { action: 'create', name: 'Personal',
    description: 'A procedure', content: 'First step' }));
  expect(created.success).toBe(true);
  const path = join(agentDir, 'skills', 'personal', 'SKILL.md');
  expect(readFileSync(path, 'utf8')).toContain('First step');
  expect((await tools.call(call('create', { action: 'delete', name: 'personal' }))).success).toBe(false);
  expect(result(await tools.call(call('list', { action: 'list' })))).toMatchObject({
    action: 'list', skills: [{ name: 'personal', description: 'A procedure' }],
  });
  expect(result(await tools.call(call('patch', { action: 'patch', name: 'personal',
    oldString: 'First step', newString: 'Second step' })))).toMatchObject({ action: 'patch' });
  expect(readFileSync(path, 'utf8')).toContain('Second step');
  active = false;
  expect((await tools.call(call('inactive', { action: 'delete', name: 'personal' }))).success).toBe(false);
  active = true;
  validRoot = false;
  expect((await tools.call(call('wrong-root', { action: 'list' }))).success).toBe(false);
  validRoot = true;
  updateSession('s', { agentId: 'another' });
  expect((await tools.call(call('wrong-agent', { action: 'delete', name: 'personal' }))).success).toBe(false);
  updateSession('s', { agentId: 'agent', preconfigId: 'another' });
  expect((await tools.call(call('wrong-preconfig', { action: 'delete', name: 'personal' }))).success).toBe(false);
  expect(readFileSync(path, 'utf8')).toContain('Second step');
});

test('symlinked skill files and directories are not delegated to the core manager', async () => {
  const outside = join(root, 'outside.md');
  writeFileSync(outside, 'Do not edit');
  putSkill(join(agentDir, 'skills'), 'personal');
  rmSync(join(agentDir, 'skills', 'personal', 'SKILL.md'));
  symlinkSync(outside, join(agentDir, 'skills', 'personal', 'SKILL.md'));
  const tools = createCodexAgentSkillTools({ bridge, sessionId: 's', workspaceId: 'ws',
    preconfigId: 'agent', agentDir, isActive: () => true, authorizeRoot: () => true });
  expect((await tools.call(call('patch-link', { action: 'patch', name: 'personal',
    oldString: 'Do not edit', newString: 'Bad' }))).success).toBe(false);
  expect(readFileSync(outside, 'utf8')).toBe('Do not edit');
  rmSync(join(agentDir, 'skills', 'personal'), { recursive: true });
  rmSync(join(agentDir, 'skills'), { recursive: true });
  symlinkSync(workspaceRoot, join(agentDir, 'skills'), 'dir');
  expect((await tools.call(call('root-link', { action: 'create', name: 'bad',
    description: 'bad', content: 'bad' }))).success).toBe(false);
  rmSync(outside);
});
