import type { SessionHarness } from '@prokopai/sdk';

/** Persisted harness enablement. Only external harnesses can be disabled; prokop is implicit. */
export interface HarnessSettings {
  disabled: SessionHarness[];
}

/** Boundary contract implemented by the SQLite server-settings repository. */
export interface HarnessSettingsRepository {
  read(): unknown;
  write(settings: HarnessSettings): void;
}
