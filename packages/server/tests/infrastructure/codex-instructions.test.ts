import { expect, test } from 'bun:test';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import { codexDeveloperInstructions, defaultCodexPreconfigId } from '@/harnesses/codex-cli/instructions';

const primary = { id: 'primary', mode: 'primary', systemPrompt: 'Work carefully.' } as Preconfig;
const other = { id: 'other', mode: 'primary', systemPrompt: 'Another.' } as Preconfig;
const subagent = { id: 'explore', mode: 'subagent' } as Preconfig;
const workspace = { additionalPaths: ['/projects/related'], settings: {} } as Workspace;

test('Codex workspace default follows workspace override, agent home, visible primary, then first primary', () => {
  const available = [primary, other, subagent];
  expect(defaultCodexPreconfigId(workspace, available)).toBe('primary');
  expect(defaultCodexPreconfigId({ ...workspace, settings: { preconfigs: { selectedIds: ['other'], defaultId: null } } }, available))
    .toBe('other');
  expect(defaultCodexPreconfigId({ ...workspace, settings: { preconfigs: { selectedIds: ['other'], defaultId: 'primary' } } }, available))
    .toBe('primary');
  expect(defaultCodexPreconfigId({ ...workspace, settings: { isAgentHome: true, agentId: 'other' } }, available))
    .toBe('other');
  expect(defaultCodexPreconfigId(workspace, [subagent])).toBeNull();
});

test('Codex developer instructions retain agent identity and workspace paths without Prokop tool rules', async () => {
  const sources = {
    listPreconfigs: async () => [primary],
    getPreconfig: async () => primary,
    getAgentDirectory: async () => '/agents/primary',
    readAgentMemoryFile: async (_id: string, name: 'MEMORY.md' | 'USER.md') =>
      name === 'MEMORY.md' ? 'Agent fact' : 'Agent preference',
  };
  const text = await codexDeveloperInstructions(workspace, '/projects/worktree', primary, sources);
  expect(text).toContain('Home directory: /agents/primary/home');
  expect(text).toContain('- /agents/primary/MEMORY.md');
  expect(text).toContain('- /agents/primary/USER.md');
  expect(text.indexOf('Home directory:')).toBeLessThan(text.indexOf('Agent fact'));
  expect(text.indexOf('Agent fact')).toBeLessThan(text.indexOf('Agent preference'));
  expect(text.indexOf('Agent preference')).toBeLessThan(text.indexOf('Work carefully.'));
  expect(text).toContain('Working directory: /projects/worktree');
  expect(text).toContain('- /projects/related');
  expect(text).toContain('subject to Codex sandbox and approvals');
  expect(text).not.toContain('AGENTS.md');
  expect(text).not.toContain('Use the `cwd` parameter');
});

test('a plain preconfig does not advertise an agent home or agent memory files', async () => {
  const text = await codexDeveloperInstructions(workspace, '/projects/worktree', primary, {
    listPreconfigs: async () => [primary],
    getPreconfig: async () => primary,
    getAgentDirectory: async () => null,
    readAgentMemoryFile: async () => { throw new Error('No agent memory should be read'); },
  });
  expect(text).toContain('Work carefully.');
  expect(text).not.toContain('<agent_home>');
  expect(text).not.toContain('<agent_memory>');
  expect(text).not.toContain('USER.md');
});
