import { describe, expect, test } from 'bun:test';
import type { Preconfig } from '@prokopai/sdk';
import {
  AGENT_MEMORY_MEMORY_FILENAME,
  AGENT_MEMORY_USER_FILENAME,
  agentDirectoryPath,
  agentHomeDirectoryPath,
  agentHomeDotProkopDirectoryPath,
  agentHomeWorkspaceId,
  agentHomeWorkspaceSettings,
  agentMemoryFilename,
  agentSkillsDirectoryPath,
  agentsRoot,
  buildAgentHomeWorkspaceInput,
  buildAgentRecord,
  effectivePreconfigMode,
  firstUnknownSubagentId,
  isSubagentTargetPreconfig,
  knownSubagentIds,
  sanitizeCanSpawnSubagentsIds,
  shouldMaterializeAgent,
} from '@/domains/agents';
import { PROMOTION_ERRORS } from '@/domains/agents';

function preconfig(overrides: Partial<Preconfig> = {}): Preconfig {
  return {
    id: 'explore',
    name: 'Explore',
    description: 'Research tasks',
    systemPrompt: '',
    tools: [],
    model: null,
    provider: null,
    variant: null,
    settings: null,
    isDefault: false,
    ...overrides,
  } as Preconfig;
}

describe('agents domain: home directory semantics', () => {
  test('derives the exact directory layout from the data directory', () => {
    expect(agentsRoot('/data')).toBe('/data/agents');
    expect(agentDirectoryPath('/data', 'coder')).toBe('/data/agents/coder');
    expect(agentSkillsDirectoryPath('/data', 'coder')).toBe('/data/agents/coder/skills');
    expect(agentHomeDirectoryPath('/data', 'coder')).toBe('/data/agents/coder/home');
    expect(agentHomeDotProkopDirectoryPath('/data', 'coder')).toBe('/data/agents/coder/home/.prokopai');
  });

  test('derives the home workspace id, memory filenames, and the exact home workspace template', () => {
    expect(agentHomeWorkspaceId('coder')).toBe('coder-home');
    expect(agentMemoryFilename('user')).toBe(AGENT_MEMORY_USER_FILENAME);
    expect(agentMemoryFilename('memory')).toBe(AGENT_MEMORY_MEMORY_FILENAME);

    const input = buildAgentHomeWorkspaceInput('coder', '/data/agents/coder/home');
    expect(input).toEqual({
      id: 'coder-home',
      name: 'coder-home',
      path: '/data/agents/coder/home',
      isVirtual: true,
    });

    expect(agentHomeWorkspaceSettings('coder')).toEqual({
      isAgentHome: true,
      agentId: 'coder',
    });
  });
});

describe('agents domain: promotion policy', () => {
  test('builds the agent record shape from a preconfig plus home marker and creation time', () => {
    const record = buildAgentRecord(preconfig({ id: 'coder' }), true, '2026-08-16T00:00:00.000Z');
    expect(record).toEqual({
      ...preconfig({ id: 'coder' }),
      hasHome: true,
      createdAt: '2026-08-16T00:00:00.000Z',
    });
  });

  test('pins the exact promotion error messages', () => {
    expect(PROMOTION_ERRORS).toEqual({
      preconfigNotFound: 'Preconfig not found',
      subagentOnlyNotPromotable: 'Subagent-only preconfigs cannot be promoted to agents',
      alreadyAgent: 'Already an agent',
      failedToCreate: 'Failed to create agent',
    });
  });
});

describe('agents domain: subagent configuration rules', () => {
  test('classifies subagent targets by effective mode', () => {
    expect(effectivePreconfigMode(undefined)).toBe('primary');
    expect(effectivePreconfigMode('primary')).toBe('primary');
    expect(isSubagentTargetPreconfig(preconfig({ mode: 'subagent' }))).toBe(true);
    expect(isSubagentTargetPreconfig(preconfig({ mode: 'both' }))).toBe(true);
    expect(isSubagentTargetPreconfig(preconfig({ mode: 'primary' }))).toBe(false);
    expect(isSubagentTargetPreconfig(preconfig())).toBe(false);
  });

  test('materializes every primary/both preconfig and skips subagent-only ones', () => {
    expect(shouldMaterializeAgent(preconfig())).toBe(true);
    expect(shouldMaterializeAgent(preconfig({ mode: 'primary' }))).toBe(true);
    expect(shouldMaterializeAgent(preconfig({ mode: 'both' }))).toBe(true);
    expect(shouldMaterializeAgent(preconfig({ mode: 'subagent' }))).toBe(false);
  });

  test('computes known subagent ids and sanitizes configured id lists in order', () => {
    const all = [
      preconfig({ id: 'explore', mode: 'subagent' }),
      preconfig({ id: 'coder', mode: 'both' }),
      preconfig({ id: 'plain', mode: 'primary' }),
    ];
    expect(knownSubagentIds(all)).toEqual(new Set(['explore', 'coder']));

    const sanitized = sanitizeCanSpawnSubagentsIds(
      ['coder', 'ghost', 'explore', 'missing'],
      knownSubagentIds(all),
    );
    expect(sanitized).toEqual({ validIds: ['coder', 'explore'], invalidIds: ['ghost', 'missing'] });
    expect(firstUnknownSubagentId(['coder', 'ghost'], knownSubagentIds(all))).toBe('ghost');
    expect(firstUnknownSubagentId(['coder', 'explore'], knownSubagentIds(all))).toBeNull();
  });
});
