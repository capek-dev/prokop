import { describe, expect, test } from 'bun:test';
import { readPermissionAskDetails } from '../src/index';
import type { PermissionAsk } from '../src/index';

function ask(extra: Record<string, unknown>): PermissionAsk {
  return {
    type: 'permission',
    question: 'Allow this command to run?',
    resource: 'shell-command',
    action: 'execute',
    risk: 'high',
    ...extra,
  } as PermissionAsk;
}

describe('readPermissionAskDetails', () => {
  test('reads validated details off a classified ask', () => {
    const details = readPermissionAskDetails(ask({
      concerns: ['destructive', 'escape', 'sensitive'],
      catastrophic: false,
      evidence: ['rm with a destructive flag', 'path /etc is outside the allowed roots'],
    }));
    expect(details).toEqual({
      concerns: ['destructive', 'escape', 'sensitive'],
      catastrophic: false,
      evidence: ['rm with a destructive flag', 'path /etc is outside the allowed roots'],
      highlights: [],
      commandSegments: [],
    });
  });

  test('reads highlights and command segments, dropping malformed spans', () => {
    const details = readPermissionAskDetails(ask({
      concerns: ['destructive'],
      catastrophic: false,
      highlights: [
        { start: 0, end: 9, reason: 'deletes recursively or without confirmation', extra: 1 },
        { start: 4, end: 2, reason: 'reversed' },
        { start: 1.5, end: 3, reason: 'fractional' },
        { start: 0, end: 3, reason: '' },
        { start: 0, end: 3 },
        null,
      ],
      commandSegments: [{ start: 0, end: 9 }, { start: -1, end: 3 }, 'x'],
    }));
    expect(details?.highlights).toEqual([
      { start: 0, end: 9, reason: 'deletes recursively or without confirmation' },
    ]);
    expect(details?.commandSegments).toEqual([{ start: 0, end: 9 }]);
  });

  test('returns null for legacy asks without concern fields', () => {
    expect(readPermissionAskDetails(ask({ risk: 'medium' }))).toBeNull();
    expect(readPermissionAskDetails(ask({ concerns: undefined }))).toBeNull();
  });

  test('drops unknown concern strings and non-string evidence', () => {
    const details = readPermissionAskDetails(ask({
      concerns: ['destructive', 'future-concern', 42],
      catastrophic: 'yes',
      evidence: ['valid line', '', 7, null],
    }));
    expect(details).toEqual({
      concerns: ['destructive'],
      catastrophic: false,
      evidence: ['valid line'],
      highlights: [],
      commandSegments: [],
    });
  });

  test('catastrophic only when exactly true; evidence caps at 8 lines', () => {
    const details = readPermissionAskDetails(ask({
      concerns: ['destructive'],
      catastrophic: true,
      evidence: Array.from({ length: 12 }, (_, i) => `line ${i}`),
    }));
    expect(details?.catastrophic).toBe(true);
    expect(details?.evidence).toHaveLength(8);
    expect(details?.evidence[7]).toBe('line 7');
  });
});
