import { describe, expect, test } from 'vitest';
import { getSessionTagOrder, orderedSessionGroupNames } from '@/lib/sessionTagOrder';

describe('session tag ordering', () => {
  test('defaults missing and malformed settings to tagged first', () => {
    for (const value of [undefined, null, 'invalid', true, {}]) {
      expect(getSessionTagOrder(value)).toBe('tagged-first');
    }
    expect(getSessionTagOrder('untagged-first')).toBe('untagged-first');
  });

  test('moves only the untagged bucket without mutating tag recency order', () => {
    const tags = Object.freeze(['recent', 'older']);
    expect(orderedSessionGroupNames(tags, true)).toEqual(['recent', 'older', '__ungrouped__']);
    expect(orderedSessionGroupNames(tags, true, 'untagged-first')).toEqual(['__ungrouped__', 'recent', 'older']);
    expect(tags).toEqual(['recent', 'older']);
  });

  test('handles empty and single-kind lists', () => {
    expect(orderedSessionGroupNames([], false)).toEqual([]);
    expect(orderedSessionGroupNames([], true, 'untagged-first')).toEqual(['__ungrouped__']);
    expect(orderedSessionGroupNames(['tag'], false, 'untagged-first')).toEqual(['tag']);
  });
});
