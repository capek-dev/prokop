import { beforeEach, afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Preconfig, Workspace } from '@prokopai/sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import { setupTestDatabase, resetTestDatabase } from '#tests/db';
import { seedWorkspace } from '#tests/seed';
import { Paths } from '@/infrastructure/runtime/paths';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { createSession, getSession } from '@/infrastructure/sqlite/session-store';
import { listMessagesWithParts } from '@/infrastructure/sqlite/message-store';
import { saveClaudeModelSelection } from '@/harnesses/claude-cli/models';
import { createClaudeExecution } from '@/harnesses/claude-cli/execution';
import { claudeDeveloperInstructions, defaultClaudePreconfigId } from '@/harnesses/claude-cli/instructions';

const agent = { id: 'agent', mode: 'primary', systemPrompt: 'Work carefully.' } as Preconfig;
const plainWorkspace = { additionalPaths: ['/projects/related'], settings: {} } as Workspace;

function plainSources(dir: string | null): import('@/harnesses/claude-cli/instructions').ClaudeInstructionSources {
  return {
    listPreconfigs: async () => [agent],
    getPreconfig: async () => agent,
    getAgentDirectory: async () => dir,
    readAgentMemoryFile: async (_id: string, name: 'MEMORY.md' | 'USER.md') =>
      name === 'MEMORY.md' ? 'Agent fact' : 'Agent preference',
  };
}

test('Claude workspace default preconfig mirrors the Codex selection rules', () => {
  expect(defaultClaudePreconfigId(plainWorkspace, [agent])).toBe('agent');
  expect(defaultClaudePreconfigId({ ...plainWorkspace, settings: { preconfigs: { selectedIds: ['other'], defaultId: null } } },
    [agent, { id: 'other', mode: 'primary' } as Preconfig])).toBe('other');
  expect(defaultClaudePreconfigId(plainWorkspace, [{ id: 'explore', mode: 'subagent' } as Preconfig])).toBeNull();
});

test('Claude developer instructions retain agent identity, skills, and workspace paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-instructions-'));
  try {
    mkdirSync(join(dir, 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(dir, 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: Ship the app\n---\nSteps.');
    const text = await claudeDeveloperInstructions(plainWorkspace, '/projects/worktree',
      { ...agent, skills: ['deploy'] } as Preconfig, plainSources(dir));
    expect(text).toContain(`Home directory: ${join(dir, 'home')}`);
    expect(text).toContain(`- ${join(dir, 'MEMORY.md')}`);
    expect(text.indexOf('Agent fact')).toBeLessThan(text.indexOf('Agent preference'));
    expect(text.indexOf('Agent preference')).toBeLessThan(text.indexOf('Work carefully.'));
    expect(text).toContain('- deploy: Ship the app');
    expect(text).toContain('wait for its result within this turn');
    expect(text).toContain('Working directory: /projects/worktree');
    expect(text).toContain('- /projects/related');
    expect(text).toContain('subject to Prokop permission approvals');
    expect(text).not.toContain('Codex sandbox');
    const blocked = await claudeDeveloperInstructions(plainWorkspace, '/projects/worktree',
      { ...agent, skills: [] } as Preconfig, plainSources(dir));
    expect(blocked).not.toContain('agent_home_skills');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Claude memory and session-search guidance appear only with their tools and settings', async () => {
  const withHome = plainSources('/agents/agent');
  const memoryEnabled = { ...plainWorkspace,
    settings: { memory: { enabled: true, permissionRisk: 'none' as const } } } as Workspace;
  const both = await claudeDeveloperInstructions(memoryEnabled, '/projects/worktree', agent,
    withHome, ['memory', 'agent_memory']);
  expect(both).toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(both).toContain('Use "agent_memory" (personal) for cross-project knowledge');
  const agentOnly = await claudeDeveloperInstructions(memoryEnabled, '/projects/worktree', agent,
    withHome, ['agent_memory']);
  expect(agentOnly).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(agentOnly).toContain('Use "agent_memory" (personal) for cross-project knowledge');
  expect(await claudeDeveloperInstructions(plainWorkspace, '/projects/worktree', agent,
    withHome, ['memory'])).not.toContain('You can persist durable workspace knowledge using the memory tool.');
  expect(await claudeDeveloperInstructions(memoryEnabled, '/projects/worktree', agent,
    plainSources(null), ['agent_memory'])).not.toContain('Use "agent_memory" (personal)');
  const searchEnabled = { ...plainWorkspace, settings: { sessionSearch: {
    enabled: true, permissionRisk: 'none' as const, includeToolResults: false } } } as Workspace;
  expect(await claudeDeveloperInstructions(searchEnabled, '/projects/worktree', agent,
    withHome, ['session_search'])).toContain('Use session_search to recall past conversations');
  expect(await claudeDeveloperInstructions(searchEnabled, '/projects/worktree', agent, withHome))
    .not.toContain('Use session_search to recall past conversations');
});

test('a plain Claude preconfig does not advertise an agent home or memory files', async () => {
  const text = await claudeDeveloperInstructions(plainWorkspace, '/projects/worktree', agent, {
    listPreconfigs: async () => [agent],
    getPreconfig: async () => agent,
    getAgentDirectory: async () => null,
    readAgentMemoryFile: async () => { throw new Error('No agent memory should be read'); },
  });
  expect(text).toContain('Work carefully.');
  expect(text).not.toContain('<agent_home>');
  expect(text).not.toContain('<agent_memory>');
});

let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(process.cwd(), '.claude-instructions-test-'));
  mkdirSync(join(dataDir, 'tools'));
  Paths.configure({ dataDir });
  setupTestDatabase();
  seedWorkspace({ id: 'ws', path: process.cwd() });
  createSession({ id: 'session', workspaceId: 'ws', title: 'Claude', status: 'active',
    preconfigId: null, metadata: null, parentId: null, agentName: null, harness: 'claude-cli' });
  saveClaudeModelSelection('session', { model: 'claude-sonnet-5', effort: 'medium' });
});
afterEach(() => { resetTestDatabase(); Paths.reset(); rmSync(dataDir, { recursive: true, force: true }); });

function execFixture(sources?: import('@/harnesses/claude-cli/instructions').ClaudeInstructionSources) {
  const events: unknown[] = [];
  const wire = { actor: { attachOriginToSession: () => {} }, delivery: {
    send: (_origin: string, value: unknown) => events.push(value),
    broadcastToSession: (_id: string, value: unknown) => events.push(value),
    broadcast: (value: unknown) => events.push(value),
  } } as unknown as SessionWirePorts<string>;
  let seen: Options | undefined;
  const exec = createClaudeExecution({ version: () => '2.1.274', instructions: sources,
    start: (_prompt, options) => {
      seen = options;
      const sessionId = options.sessionId ?? crypto.randomUUID();
      async function* messages(): AsyncGenerator<SDKMessage> {
        yield { type: 'system', subtype: 'init', session_id: sessionId } as SDKMessage;
        yield { type: 'result', subtype: 'success', session_id: sessionId, result: 'reply' } as SDKMessage;
      }
      return messages();
    } });
  const binding = () => getDatabase().query<{ native_session_id: string }, []>(
    'SELECT native_session_id FROM claude_session_bindings').get();
  return { exec, wire, events, options: () => seen, binding };
}

test('Claude turns append developer instructions and persist the resolved preconfig', async () => {
  const f = execFixture(plainSources(null));
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'hello');
  expect(f.options()?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code',
    append: expect.stringContaining('Work carefully.') });
  expect((f.options()?.systemPrompt as { append: string } | undefined)?.append).toContain('Working directory:');
  expect(getSession('session')?.preconfigId).toBe('agent');
  expect(f.binding()).not.toBeNull();
});

test('Claude without any preconfig refuses the turn before any native work', async () => {
  const f = execFixture({ ...plainSources(null), listPreconfigs: async () => [] });
  await f.exec.sendMessage(f.wire, 'origin', 'session', 'hello');
  expect(f.events).toContainEqual(expect.objectContaining({ type: 'error', message: 'Claude requires a preconfig' }));
  expect(f.binding()).toBeNull();
  expect(listMessagesWithParts('session')).toHaveLength(0);
});
