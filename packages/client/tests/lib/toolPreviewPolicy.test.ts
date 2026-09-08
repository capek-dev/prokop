import { describe, expect, test } from 'vitest';
import type { Message } from '@prokopai/sdk';
import { getToolPreviewCutoff } from '@/lib/toolPreviewPolicy';

function item(role: 'user' | 'assistant', isQueued = false) {
  return { message: { role } as Message, isQueued };
}

describe('getToolPreviewCutoff', () => {
  test('keeps the latest three submitted prompt windows', () => {
    expect(getToolPreviewCutoff([
      item('user'), item('assistant'), item('assistant'),
      item('user'), item('assistant'), item('user'), item('assistant'),
      item('user'), item('assistant'),
    ])).toBe(3);
  });

  test('queued prompts do not age the current conversation', () => {
    expect(getToolPreviewCutoff([
      item('user'), item('assistant'), item('user'), item('assistant'),
      item('user', true), item('user', true),
    ])).toBe(0);
  });

  test('partial pages without three prompts retain previews', () => {
    expect(getToolPreviewCutoff([])).toBe(0);
    expect(getToolPreviewCutoff([item('assistant')])).toBe(0);
    expect(getToolPreviewCutoff([item('assistant'), item('user'), item('assistant')])).toBe(0);
  });
});
