import type { Database } from 'bun:sqlite';
import type {
  RemoteAccessSettings,
  RemoteAccessSettingsRepository,
} from '@/application/ports/remote-access';

const REMOTE_ACCESS_KEY = 'remote_access';

/** Stores remote-access settings as one JSON row in `server_settings`; malformed rows read as null. */
export function createRemoteAccessSettingsRepository(getDatabase: () => Database): RemoteAccessSettingsRepository {
  return {
    read(): unknown {
      const row = getDatabase()
        .query<{ value: string }, [string]>('SELECT value FROM server_settings WHERE key = ?')
        .get(REMOTE_ACCESS_KEY);
      if (!row) return null;
      try {
        return JSON.parse(row.value) as unknown;
      } catch {
        return null;
      }
    },
    write(settings: RemoteAccessSettings): void {
      getDatabase()
        .query(
          `INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(REMOTE_ACCESS_KEY, JSON.stringify(settings), Date.now());
    },
  };
}
