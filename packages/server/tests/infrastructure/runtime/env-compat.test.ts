import { describe, test, expect, beforeEach } from 'bun:test';
import {
  readEnv,
  readEnvInt,
  readEnvFloat,
  resetEnvCompatWarnings,
  PROKOPAI_ENV_PREFIX,
  JEAN2_ENV_PREFIX,
} from '@/infrastructure/runtime/env-compat';

describe('env-compat', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    resetEnvCompatWarnings();
    for (const suffix of ['TEST_VALUE', 'TEST_INT', 'TEST_FLOAT']) {
      const p = `${PROKOPAI_ENV_PREFIX}${suffix}`;
      const j = `${JEAN2_ENV_PREFIX}${suffix}`;
      saved[p] = process.env[p];
      saved[j] = process.env[j];
      delete process.env[p];
      delete process.env[j];
    }
  });

  test('canonical PROKOPAI_ wins over legacy JEAN2_', () => {
    process.env.JEAN2_TEST_VALUE = 'legacy';
    process.env.PROKOPAI_TEST_VALUE = 'canonical';
    expect(readEnv('TEST_VALUE')).toBe('canonical');
  });

  test('falls back to JEAN2_ when PROKOPAI_ unset', () => {
    process.env.JEAN2_TEST_VALUE = 'legacy';
    expect(readEnv('TEST_VALUE')).toBe('legacy');
  });

  test('undefined when neither set', () => {
    expect(readEnv('TEST_VALUE')).toBeUndefined();
  });

  test('readEnvInt parses canonical and legacy with defaults', () => {
    process.env.PROKOPAI_TEST_INT = '42';
    expect(readEnvInt('TEST_INT', 0)).toBe(42);

    delete process.env.PROKOPAI_TEST_INT;
    process.env.JEAN2_TEST_INT = '17';
    expect(readEnvInt('TEST_INT', 0)).toBe(17);

    delete process.env.JEAN2_TEST_INT;
    expect(readEnvInt('TEST_INT', 7)).toBe(7);
  });

  test('readEnvFloat parses canonical and legacy with defaults', () => {
    process.env.PROKOPAI_TEST_FLOAT = '0.5';
    expect(readEnvFloat('TEST_FLOAT', 0)).toBe(0.5);

    delete process.env.PROKOPAI_TEST_FLOAT;
    process.env.JEAN2_TEST_FLOAT = '0.25';
    expect(readEnvFloat('TEST_FLOAT', 0)).toBe(0.25);

    delete process.env.JEAN2_TEST_FLOAT;
    expect(readEnvFloat('TEST_FLOAT', 0.75)).toBe(0.75);
  });

  test('legacy fallback warns once per key', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
      process.env.JEAN2_TEST_VALUE = 'legacy';
      readEnv('TEST_VALUE');
      readEnv('TEST_VALUE');
      readEnv('TEST_VALUE');

      const legacyWarnings = warnings.filter((w) => w.includes('JEAN2_TEST_VALUE'));
      expect(legacyWarnings.length).toBe(1);
    } finally {
      console.warn = original;
    }
  });

  test('canonical use does not warn', () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (msg: string) => warnings.push(msg);

    try {
      process.env.PROKOPAI_TEST_VALUE = 'canonical';
      process.env.JEAN2_TEST_VALUE = 'legacy';
      readEnv('TEST_VALUE');
      expect(warnings.filter((w) => w.includes('TEST_VALUE')).length).toBe(0);
    } finally {
      console.warn = original;
    }
  });
});
