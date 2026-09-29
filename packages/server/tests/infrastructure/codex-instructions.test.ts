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
  expect(text).toContain('Agent skills directory: /agents/primary/skills');
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
  expect(text).toContain('wait for its result within this turn');
  expect(text).toContain('A completed parent turn is not automatically resumed');
});

test('Codex includes Prokop memory guidance only for tools available in this session', async () => {
  const sources = {
    listPreconfigs: async () => [primary],
    getPreconfig: async () => primary,
    getAgentDirectory: async () => '/agents/primary',
    readAgentMemoryFile: async () => null,
  };
  const enabled = { ...workspace, settings: { memory: { enabled: true, permissionRisk: 'none' as const } } };
  const both = await codexDeveloperInstructions(enabled, '/projects/worktree', primary, sources,
    ['memory', 'agent_memory']);
  expect(both).toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(both).toContain('Character limits: user=1500, workspace=2500.');
  expect(both).toContain('If memory is full, consolidate existing entries with replace before adding.');
  expect(both).toContain('Use "agent_memory" (personal) for cross-project knowledge');
  expect(both).toContain('Before saving, use list to check existing entries and avoid duplicates.');
  expect(both).not.toContain('skill_manage');
  const agentOnly = await codexDeveloperInstructions(enabled, '/projects/worktree', primary, sources,
    ['agent_memory']);
  expect(agentOnly).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(agentOnly).not.toContain('Use "memory" (workspace)');
  expect(agentOnly).toContain('Use "agent_memory" (personal)');
  const disabled = await codexDeveloperInstructions(workspace, '/projects/worktree', primary, sources,
    ['memory', 'agent_memory']);
  expect(disabled).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  const none = await codexDeveloperInstructions(enabled, '/projects/worktree', primary, sources);
  expect(none).not.toContain('Before saving, use list to check existing entries and avoid duplicates.');
  expect(none).not.toContain('You can persist durable workspace knowledge using the memory tool.');
});

test('Codex session search guidance follows the advertised tool and workspace setting', async () => {
  const sources = {
    listPreconfigs: async () => [primary], getPreconfig: async () => primary,
    getAgentDirectory: async () => null, readAgentMemoryFile: async () => null,
  };
  const enabled = { ...workspace, settings: { sessionSearch: {
    enabled: true, permissionRisk: 'none' as const, includeToolResults: false,
  } } };
  const available = await codexDeveloperInstructions(enabled, '/projects/worktree', primary,
    sources, ['session_search']);
  expect(available).toContain('Use session_search to recall past conversations');
  expect(available).toContain('Prefer current_session for this conversation');
  expect(available).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(await codexDeveloperInstructions(enabled, '/projects/worktree', primary, sources))
    .not.toContain('Use session_search to recall past conversations');
  expect(await codexDeveloperInstructions(workspace, '/projects/worktree', primary, sources, ['session_search']))
    .not.toContain('Use session_search to recall past conversations');
});

test('a plain preconfig does not advertise an agent home or agent memory files', async () => {
  const text = await codexDeveloperInstructions(workspace, '/projects/worktree', primary, {
    listPreconfigs: async () => [primary],
    getPreconfig: async () => primary,
    getAgentDirectory: async () => null,
    readAgentMemoryFile: async () => { throw new Error('No agent memory should be read'); },
  }, ['agent_memory']);
  expect(text).toContain('Work carefully.');
  expect(text).not.toContain('You have personal memory that travels with you across all workspaces.');
  expect(text).not.toContain('<agent_home>');
  expect(text).not.toContain('<agent_memory>');
  expect(text).not.toContain('USER.md');
});
