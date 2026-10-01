import type { SessionHarness } from '@prokopai/sdk';
import type { HarnessSettings, HarnessSettingsRepository } from '@/application/ports/harness-settings';

/** External harnesses that can be disabled. Prokop is the built-in runtime and stays enabled. */
export const DISABLEABLE_HARNESSES: readonly SessionHarness[] = ['codex-cli', 'claude-cli'];

/**
 * Server-owned normalization: unknown or prokop entries, malformed payloads,
 * and duplicates collapse to a clean disabled list. Storage is never trusted
 * raw, so a corrupted row fails open (harness enabled) instead of bricking
 * session creation.
 */
export function normalizeHarnessSettings(raw: unknown): HarnessSettings {
  if (typeof raw !== 'object' || raw === null) return { disabled: [] };
  const disabled = (raw as { disabled?: unknown }).disabled;
  if (!Array.isArray(disabled)) return { disabled: [] };
  return { disabled: DISABLEABLE_HARNESSES.filter(harness => disabled.includes(harness)) };
}

export type HarnessEnableResult =
  | { kind: 'ok'; harness: SessionHarness; settings: HarnessSettings }
  | { kind: 'not_found' }
  | { kind: 'prokop_immutable' };

export interface HarnessSettingsApplication {
  /** Disabled state for creation gates; absent wiring means nothing disabled. */
  isDisabled(harness: SessionHarness): boolean;
  listDisabled(): SessionHarness[];
  setEnabled(harness: SessionHarness, enabled: boolean): HarnessEnableResult;
}

export function createHarnessSettingsApplication(
  repository: HarnessSettingsRepository,
): HarnessSettingsApplication {
  let current = normalizeHarnessSettings(repository.read());
  return {
    isDisabled(harness) {
      return current.disabled.includes(harness);
    },
    listDisabled() {
      return [...current.disabled];
    },
    setEnabled(harness, enabled) {
      if (harness !== 'prokop' && !DISABLEABLE_HARNESSES.includes(harness)) {
        return { kind: 'not_found' };
      }
      if (harness === 'prokop') return { kind: 'prokop_immutable' };
      let next = current.disabled;
      if (enabled) {
        next = current.disabled.filter(id => id !== harness);
      } else if (!current.disabled.includes(harness)) {
        next = [...current.disabled, harness];
      }
      current = { disabled: next };
      repository.write(current);
      return { kind: 'ok', harness, settings: current };
    },
  };
}
