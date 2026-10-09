import { describe, expect, test } from 'vitest';
import type { Part, ToolPart, ToolState } from '@prokopai/sdk';
import { estimateReasoningMs, getToolGroupStats, groupTurnParts } from '@/lib/turnParts';

function tool(id: string, state: ToolState, name = 'read', createdAt = 1): ToolPart {
  return { id, messageId: 'm', createdAt, type: 'tool', callId: id, name, state };
}
function done(id: string, name = 'read', startedAt = 1_000, completedAt = 2_000): ToolPart {
  return tool(id, { status: 'completed', input: {}, output: null, startedAt, completedAt }, name);
}
function text(id: string, createdAt = 1): Part {
  return { id, messageId: 'm', createdAt, type: 'text', text: id };
}
function reasoning(id: string, createdAt = 1): Part {
  return { id, messageId: 'm', createdAt, type: 'reasoning', text: id };
}

describe('groupTurnParts', () => {
  test('a single tool stays a plain row', () => {
    const segments = groupTurnParts([reasoning('r'), done('t1'), text('answer')]);
    expect(segments.map(segment => segment.kind)).toEqual(['part', 'part', 'part']);
  });

  test('two or more tools fold with the reasoning between them, and text ends the run', () => {
    const parts = [text('intro'), reasoning('r1'), done('t1'), reasoning('r2'), done('t2'), text('answer'), done('t3')];
    const segments = groupTurnParts(parts);
    expect(segments.map(segment => segment.kind)).toEqual(['part', 'tools', 'part', 'part']);
    const group = segments[1];
    expect(group.kind === 'tools' && group.id).toBe('r1');
    expect(group.kind === 'tools' && group.items.map(item => item.index)).toEqual([1, 2, 3, 4]);
  });
});

describe('getToolGroupStats', () => {
  test('counts names, failures, diff totals and wall time', () => {
    const edit = done('e1', 'edit', 2_000, 2_500);
    edit.presentation = {
      summary: '', debugAvailable: false,
      visualization: { type: 'diff', path: 'a.ts', hunks: [], additions: 5, deletions: 2 },
    };
    const stats = getToolGroupStats([
      done('t1', 'read', 1_000, 1_500),
      edit,
      done('t2', 'read', 1_500, 1_800),
      tool('t3', { status: 'error', input: {}, error: 'boom', startedAt: 2_600, failedAt: 4_000 }, 'bash'),
    ]);
    expect(stats).toEqual({
      toolCount: 4,
      failedCount: 1,
      active: false,
      names: [{ name: 'read', count: 2 }, { name: 'edit', count: 1 }, { name: 'bash', count: 1 }],
      additions: 5,
      deletions: 2,
      durationMs: 3_000,
    });
  });

  test('a running tool marks the group active with no duration yet', () => {
    const stats = getToolGroupStats([done('t1'), tool('t2', { status: 'running', input: {}, startedAt: 2_000 })]);
    expect(stats.active).toBe(true);
    expect(stats.durationMs).toBeUndefined();
  });
});

describe('estimateReasoningMs', () => {
  test('uses the next part creation time and drops sub-second noise', () => {
    const parts = [reasoning('r1', 1_000), text('t', 13_000), reasoning('r2', 14_000), text('u', 14_400)];
    expect(estimateReasoningMs(parts, 0)).toBe(12_000);
    expect(estimateReasoningMs(parts, 2)).toBeUndefined();
    expect(estimateReasoningMs(parts, 3)).toBeUndefined();
  });
});
