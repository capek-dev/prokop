import { describe, expect, test } from 'bun:test';
import { SHELL_DANGEROUS_COMMANDS, getEffectiveShellCommandIdentity } from '../src/index';

describe('@capekai/types', () => {
  test('resolves the public contract', () => {
    expect(Array.isArray(SHELL_DANGEROUS_COMMANDS)).toBe(true);
    expect(typeof getEffectiveShellCommandIdentity).toBe('function');
  });
});
