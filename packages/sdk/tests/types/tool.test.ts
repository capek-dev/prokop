import { describe, expect, test } from 'bun:test';
import { SHELL_DANGEROUS_COMMANDS } from '@prokopai/sdk/tool';
import type { ToolResult } from '@prokopai/sdk/tool';

describe('@prokopai/sdk/tool', () => {
  test('resolves the tool contract', () => {
    expect(Array.isArray(SHELL_DANGEROUS_COMMANDS)).toBe(true);

    const result: ToolResult = {
      success: true,
      result: { captured: true },
      modelOutput: [{
        type: 'image',
        data: 'aGVsbG8=',
        mediaType: 'image/png',
      }],
    };
    expect(result.modelOutput?.[0].type).toBe('image');
  });
});
