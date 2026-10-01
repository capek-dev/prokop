import { describe, expect, test } from 'bun:test';
import type { HarnessSettingsRepository } from '@/application/ports/harness-settings';
import {
  createHarnessSettingsApplication,
  normalizeHarnessSettings,
} from '@/application/harnesses/settings';

function memoryRepository(initial: unknown = null): { repository: HarnessSettingsRepository; readWritten: () => unknown } {
  let value: unknown = initial;
  return {
    repository: {
      read: () => value,
      write: (settings) => { value = settings; },
    },
    readWritten: () => value,
  };
}

describe('normalizeHarnessSettings', () => {
  test('malformed payloads fail open with nothing disabled', () => {
    for (const raw of [null, undefined, 'codex-cli', 12, {}, { disabled: 'codex-cli' }, { disabled: {} }, []]) {
      expect(normalizeHarnessSettings(raw)).toEqual({ disabled: [] });
    }
  });

  test('unknown and prokop entries are dropped, duplicates collapse', () => {
    expect(normalizeHarnessSettings({ disabled: ['prokop', 'nope', 'codex-cli', 'codex-cli'] }))
      .toEqual({ disabled: ['codex-cli'] });
  });
});

describe('harness settings application', () => {
  test('disable and enable round-trip through the repository', () => {
    const { repository, readWritten } = memoryRepository();
    const settings = createHarnessSettingsApplication(repository);
    expect(settings.isDisabled('codex-cli')).toBe(false);
    expect(settings.setEnabled('codex-cli', false)).toMatchObject({ kind: 'ok' });
    expect(settings.isDisabled('codex-cli')).toBe(true);
    expect(settings.listDisabled()).toEqual(['codex-cli']);
    expect(settings.setEnabled('claude-cli', false)).toMatchObject({ kind: 'ok' });
    expect(settings.listDisabled()).toEqual(['codex-cli', 'claude-cli']);
    expect(settings.setEnabled('codex-cli', true)).toMatchObject({ kind: 'ok' });
    expect(settings.listDisabled()).toEqual(['claude-cli']);
    expect(readWritten()).toEqual({ disabled: ['claude-cli'] });
  });

  test('prokop is immutable and unknown harnesses are not found', () => {
    const settings = createHarnessSettingsApplication(memoryRepository().repository);
    expect(settings.setEnabled('prokop', false)).toEqual({ kind: 'prokop_immutable' });
    expect(settings.setEnabled('prokop', true)).toEqual({ kind: 'prokop_immutable' });
  });

  test('a new application instance reads persisted state', () => {
    const { repository } = memoryRepository();
    createHarnessSettingsApplication(repository).setEnabled('claude-cli', false);
    expect(createHarnessSettingsApplication(repository).isDisabled('claude-cli')).toBe(true);
  });
});
