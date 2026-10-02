import { describe, expect, test } from 'bun:test';
import { createPreconfigSchema, updatePreconfigSchema } from '@/transport/http/routes/schemas';

// The preconfig REST boundary accepts the harness pin as a validated enum and
// rejects malformed values (fail closed at the transport boundary).

describe('preconfig modelHarness schema', () => {
  test('accepts each harness and null on create', () => {
    for (const modelHarness of ['prokop', 'codex-cli', 'claude-cli', null]) {
      const result = createPreconfigSchema.safeParse({ name: 'A', modelHarness });
      expect(result.success).toBe(true);
    }
    const omitted = createPreconfigSchema.safeParse({ name: 'A' });
    expect(omitted.success).toBe(true);
  });

  test('accepts each harness and null on update', () => {
    for (const modelHarness of ['prokop', 'codex-cli', 'claude-cli', null]) {
      const result = updatePreconfigSchema.safeParse({ modelHarness });
      expect(result.success).toBe(true);
    }
  });

  test('rejects an unknown harness value', () => {
    expect(createPreconfigSchema.safeParse({ name: 'A', modelHarness: 'openai' }).success).toBe(false);
    expect(updatePreconfigSchema.safeParse({ modelHarness: 'claude' }).success).toBe(false);
  });

  test('rejects a non-string value', () => {
    expect(createPreconfigSchema.safeParse({ name: 'A', modelHarness: 3 }).success).toBe(false);
    expect(updatePreconfigSchema.safeParse({ modelHarness: ['codex-cli'] }).success).toBe(false);
  });
});
