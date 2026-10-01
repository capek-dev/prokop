import { expect, test } from 'bun:test';
import { createTestDatabase } from '#tests/db';
import { createServerSettingsRepository } from '@/infrastructure/sqlite/server-settings';
import { createHarnessSettingsApplication } from '@/application/harnesses/settings';

test('harness settings persist across repository instances', () => {
  const db = createTestDatabase();
  try {
    const first = createHarnessSettingsApplication(createServerSettingsRepository(() => db));
    expect(first.setEnabled('codex-cli', false)).toMatchObject({ kind: 'ok' });
    expect(first.setEnabled('claude-cli', false)).toMatchObject({ kind: 'ok' });

    const second = createHarnessSettingsApplication(createServerSettingsRepository(() => db));
    expect(second.listDisabled()).toEqual(['codex-cli', 'claude-cli']);
    expect(second.setEnabled('codex-cli', true)).toMatchObject({ kind: 'ok' });
    expect(createServerSettingsRepository(() => db).read()).toEqual({ disabled: ['claude-cli'] });
  } finally {
    db.close();
  }
});

test('a corrupted harness settings row fails open', () => {
  const db = createTestDatabase();
  try {
    db.run("INSERT INTO server_settings (key, value, updated_at) VALUES ('harnesses', '{not json', 0)");
    const settings = createHarnessSettingsApplication(createServerSettingsRepository(() => db));
    expect(settings.listDisabled()).toEqual([]);
    expect(settings.isDisabled('codex-cli')).toBe(false);
  } finally {
    db.close();
  }
});
