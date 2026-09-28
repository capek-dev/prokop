import { expect, test } from 'bun:test';
import { validateCodexCliVersion } from '@/harnesses/codex-cli/version';

test('Codex CLI accepts version 0.156.0 or newer without an upper bound', () => {
  for (const version of ['codex-cli 0.156.0', 'codex-cli 0.156.1', 'codex-cli 0.157.1',
    'codex-cli 0.200.0', 'codex-cli 1.0.0']) {
    expect(validateCodexCliVersion(version)).toBe(version);
  }
});

test('Codex CLI rejects older and malformed versions', () => {
  for (const version of ['codex-cli 0.155.99', 'codex-cli 0.15.6', 'codex-cli 0.156',
    'codex-cli 0.156.0-beta.1', 'codex-cli latest', 'codex-cli 0.156.0 extra',
    'codex-cli 99999999999999999999.0.0', 'other 0.157.1']) {
    expect(() => validateCodexCliVersion(version)).toThrow('0.156.0 or newer');
  }
});
