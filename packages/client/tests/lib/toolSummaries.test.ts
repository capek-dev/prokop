import { describe, expect, test } from 'vitest';
import type { ToolPart } from '@prokopai/sdk';
import {
  chipsFromVisualization,
  getToolRowInfo,
  resolveSummaryTemplate,
} from '@/lib/toolSummaries';

function makeProjectedPart(): ToolPart {
  const visualization = {
    type: 'shell-output' as const,
    command: 'echo hello',
    stdout: 'visible output',
    stderr: '',
    exitCode: 0,
  };
  return {
    id: 'part-1',
    messageId: 'message-1',
    createdAt: 1,
    type: 'tool',
    callId: 'call-1',
    name: 'shell',
    state: {
      status: 'completed',
      input: {},
      output: { _visualization: visualization },
      startedAt: 1,
      completedAt: 2,
    },
    presentation: {
      summary: 'echo hello',
      visualization,
      debugAvailable: true,
    },
  };
}

describe('tool summaries', () => {
  test('uses eager presentation data when raw input and output are omitted', () => {
    expect(getToolRowInfo(makeProjectedPart())).toEqual({
      summary: 'echo hello',
      chips: [{ label: '[0]', tone: 'neutral' }],
    });
  });

  test('keeps dotted summary template resolution', () => {
    expect(resolveSummaryTemplate('{todos.length} items', { todos: { length: 3 } })).toBe('3 items');
  });

  test('uses file-list entity labels for generated chips', () => {
    expect(chipsFromVisualization({
      type: 'file-list',
      files: [{ path: 'Planning' }, { path: 'Review' }],
      total: 2,
      singularLabel: 'session',
      pluralLabel: 'sessions',
    })).toEqual([{ label: '2 sessions', tone: 'neutral' }]);
  });
});
