import { describe, expect, test } from 'vitest';
import type { ToolPart } from '@prokopai/sdk';
import {
  chipsFromVisualization,
  getToolRowInfo,
  resolveSummaryTemplate,
  showToolRawData,
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
      chips: [],
    });
  });

  test('only a failing exit code earns a chip', () => {
    const failed = makeProjectedPart();
    failed.presentation!.visualization = { type: 'shell-output', command: 'false', stderr: 'boom', exitCode: 2 };
    expect(getToolRowInfo(failed).chips).toEqual([{ label: '[2]', tone: 'error' }]);
  });

  test('keeps dotted summary template resolution', () => {
    expect(resolveSummaryTemplate('{todos.length} items', { todos: { length: 3 } })).toBe('3 items');
  });

  test('requires explicit raw-data expansion for chip-only and list visualizations', () => {
    const chip = { type: 'none' as const, message: 'Skill created: review' };
    const list = { type: 'file-list' as const, files: [{ path: 'review' }] };
    expect(showToolRawData(true, chip, false)).toBe(false);
    expect(showToolRawData(true, list, false)).toBe(false);
    expect(showToolRawData(true, chip, true)).toBe(true);
    expect(showToolRawData(false, chip, true)).toBe(false);
    expect(showToolRawData(true, undefined, false)).toBe(true);
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
