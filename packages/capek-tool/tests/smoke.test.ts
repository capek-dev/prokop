import { describe, expect, test } from 'bun:test';
import { SHELL_DANGEROUS_COMMANDS } from '../src/index';

describe('@capekai/tool', () => {
  test('resolves the tool contract', () => {
    expect(Array.isArray(SHELL_DANGEROUS_COMMANDS)).toBe(true);
  });
});
