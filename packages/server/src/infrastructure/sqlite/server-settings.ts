import type { Database } from 'bun:sqlite';
import type { HarnessSettings, HarnessSettingsRepository } from '@/application/ports/harness-settings';

/** Database accessor injected by the composition root; no module-global connection state. */
export type ServerSettingsDatabaseAccessor = () => Database;

const HARNESS_SETTINGS_KEY = 'harnesses';

interface ServerSettingsRow {
  key: string;
  value: string;
}

/**
 * SQLite implementation of the harness settings port. The single row keyed
 * `harnesses` stores `{"disabled":[...]}`; malformed rows read back as the
 * default (nothing disabled) rather than failing the host.
 */
export function createServerSettingsRepository(
  getDatabase: ServerSettingsDatabaseAccessor,
): HarnessSettingsRepository {
  return {
    read(): unknown {
      const row = getDatabase()
        .query<ServerSettingsRow, [string]>('SELECT key, value FROM server_settings WHERE key = ?')
        .get(HARNESS_SETTINGS_KEY);
      if (!row) return null;
      try {
        return JSON.parse(row.value) as unknown;
      } catch {
        return null;
      }
    },
    write(settings: HarnessSettings): void {
      getDatabase()
        .query(
          `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(HARNESS_SETTINGS_KEY, JSON.stringify({ disabled: settings.disabled }), Date.now());
    },
  };
}
