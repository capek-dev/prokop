import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { updateSession } from '@/infrastructure/sqlite/session-store';
import { resetTestDatabase, setupTestDatabase } from '#tests/db';
import { seedSession, seedWorkspace } from '#tests/seed';
import { collectSubagentAncestry, evaluateSubagentTarget, getSubagentResumeError, isSubagentSpawningDisabled, isValidSubagentPreconfig, isValidSubagentTargetPreconfig } from '@capekai/core/internal/execution';

function evaluate(options: {
  target: string;
  current: string | null;
  ancestry: string[];
  allowSelf?: boolean;
  maximumDepthReached?: boolean;
}) {
  return evaluateSubagentTarget({
    targetPreconfigId: options.target,
    currentPreconfigId: options.current,
    ancestryPreconfigIds: options.ancestry,
    allowSelfAsSubagent: options.allowSelf ?? false,
    maximumDepthReached: options.maximumDepthReached,
  });
}

describe('subagent ancestry policy', () => {
  test('blocks self delegation when disabled or missing', () => {
    expect(evaluate({ target: 'A', current: 'A', ancestry: ['A'] }).reason).toBe('self_disabled');
  });

  test('allows the first opted-in self delegation', () => {
    expect(evaluate({ target: 'A', current: 'A', ancestry: ['A'], allowSelf: true }).allowed).toBe(true);
  });

  test('blocks repeated immediate self delegation', () => {
    expect(evaluate({ target: 'A', current: 'A', ancestry: ['A', 'A'], allowSelf: true }).reason).toBe('repeated_ancestor');
  });

  test('blocks indirect ancestry cycles', () => {
    expect(evaluate({ target: 'A', current: 'B', ancestry: ['B', 'A'], allowSelf: true }).reason).toBe('repeated_ancestor');
  });

  test('allows unique targets before the depth limit', () => {
    expect(evaluate({ target: 'B', current: 'A', ancestry: ['A'] }).allowed).toBe(true);
    expect(evaluate({ target: 'C', current: 'B', ancestry: ['B', 'A'] }).allowed).toBe(true);
  });

  test('keeps maximum depth as an independent failure', () => {
    expect(evaluate({
      target: 'C',
      current: 'B',
      ancestry: ['B', 'A'],
      maximumDepthReached: true,
    }).reason).toBe('maximum_depth');
  });

  test('ignores missing and null ancestry values represented by omission', () => {
    expect(evaluate({ target: 'A', current: null, ancestry: [] }).allowed).toBe(true);
  });

  test('only accepts subagent-capable target modes', () => {
    expect(isValidSubagentPreconfig({ mode: 'subagent' })).toBe(true);
    expect(isValidSubagentPreconfig({ mode: 'both' })).toBe(true);
    expect(isValidSubagentPreconfig({ mode: 'primary' })).toBe(false);
    expect(isValidSubagentPreconfig({})).toBe(false);
  });

  test('allows a primary preconfig only as its own opted-in subagent', () => {
    const primary = { id: 'A', mode: 'primary' as const };

    expect(isValidSubagentTargetPreconfig(primary, 'A', true)).toBe(true);
    expect(isValidSubagentTargetPreconfig(primary, 'A', false)).toBe(false);
    expect(isValidSubagentTargetPreconfig(primary, 'B', true)).toBe(false);
  });

  test('keeps disabled spawn permissions disabled at runtime', () => {
    expect(isSubagentSpawningDisabled(false)).toBe(true);
    expect(isSubagentSpawningDisabled(null)).toBe(true);
    expect(isSubagentSpawningDisabled([])).toBe(true);
    expect(isSubagentSpawningDisabled(true)).toBe(false);
    expect(isSubagentSpawningDisabled(['B'])).toBe(false);
    expect(isSubagentSpawningDisabled(undefined)).toBe(false);
  });

  test('rejects resume tasks owned by a different parent session', () => {
    expect(getSubagentResumeError(
      { parentId: 'parent-b', preconfigId: 'A' },
      'parent-a',
      'A',
    )).toBe('Invalid task_id: does not belong to this session');
  });

  test('rejects resume tasks created for a different preconfig', () => {
    expect(getSubagentResumeError(
      { parentId: 'parent-a', preconfigId: 'B' },
      'parent-a',
      'C',
    )).toBe('Invalid task_id: belongs to subagent type "B", not "C"');
  });

  test('allows resume when parent and preconfig match', () => {
    expect(getSubagentResumeError(
      { parentId: 'parent-a', preconfigId: 'B' },
      'parent-a',
      'B',
    )).toBeNull();
  });
});

describe('subagent ancestry collection', () => {
  beforeEach(() => {
    setupTestDatabase();
    seedWorkspace();
  });

  afterEach(() => {
    resetTestDatabase();
  });

  test('walks nearest parent first and skips null preconfig IDs', () => {
    const root = seedSession('ws1', { id: 'root', preconfigId: 'A' });
    const orchestrator = seedSession('ws1', {
      id: 'orchestrator',
      parentId: root.id,
      preconfigId: null,
    });
    const child = seedSession('ws1', {
      id: 'child',
      parentId: orchestrator.id,
      preconfigId: 'B',
    });

    expect(collectSubagentAncestry(child.id)).toEqual({
      preconfigIds: ['B', 'A'],
      depth: 2,
    });
  });

  test('stops safely when session parent links form a cycle', () => {
    const first = seedSession('ws1', { id: 'first', preconfigId: 'A' });
    const second = seedSession('ws1', {
      id: 'second',
      parentId: first.id,
      preconfigId: 'B',
    });
    updateSession(first.id, { parentId: second.id });

    expect(collectSubagentAncestry(second.id)).toEqual({
      preconfigIds: ['B', 'A'],
      depth: 2,
    });
  });
});
