import { expect, test } from 'vitest';
import { conflictSections, hasConflictMarkers } from '@/components/files/rebaseConflictSections';

test.each(['\n', '\r\n'])('diff3 section preserves line endings %j and omits ancestor', (nl) => {
  const text = ['before', '<<<<<<<< base', 'base', '|||||||| ancestor', 'old', '========', 'feature', '>>>>>>>> feature', 'after'].join(nl);
  const [section] = conflictSections(text);
  expect(section.base).toBe(`base${nl}`);
  expect(section.feature).toBe(`feature${nl}`);
  expect(section.line).toBe(2);
  expect(text.slice(0, section.start) + section.feature + text.slice(section.end)).toBe(['before', 'feature', 'after'].join(nl));
});
test('multiple conflicts retain exact offsets and malformed markers cannot be saved', () => {
  const block = '<<<<<<< base\na\n=======\nb\n>>>>>>> feature\n';
  const sections = conflictSections(block + 'middle\n' + block);
  expect(sections).toHaveLength(2);
  expect(sections[1].start).toBe(block.length + 7);
  expect(conflictSections('<<<<<<< base\na\n')).toEqual([]);
  expect(hasConflictMarkers('<<<<<<< base\na\n')).toBe(true);
  expect(hasConflictMarkers('normal text')).toBe(false);
});
