/**
 * Activation and disposal execution. Activation follows the deterministic
 * plan; on failure, completed registrations roll back in reverse order with
 * both the setup error and disposal errors preserved. Normal disposal runs
 * in reverse activation order and aggregates failures.
 */

import {
  ActivationError,
  DisposalError,
  type DisposalFailure,
} from './errors';
import { enforceDeclaredProvides, isDisposable, type PluginRecord } from './plugin';
import type { PluginOptionsMap } from './types';

export async function activateRecords(
  records: readonly PluginRecord[],
  order: readonly string[],
  options: PluginOptionsMap,
): Promise<void> {
  const byId = new Map(records.map((record) => [record.id, record]));
  const completed: PluginRecord[] = [];
  for (const id of order) {
    const record = byId.get(id) as PluginRecord;
    try {
      const result = await record.plugin.setup(record.context, options[id]);
      if (isDisposable(result)) {
        record.returnedDisposable = result;
      }
      enforceDeclaredProvides(record);
      record.status = 'active';
      completed.push(record);
    } catch (err) {
      record.status = 'failed';
      const failures = await disposeRecords([...completed, record]);
      throw new ActivationError(record.id, err, failures);
    }
  }
}

/** Disposes records in reverse order. Every disposer is attempted even when
 * earlier disposers throw. Returns the collected failures. */
export async function disposeRecords(
  records: readonly PluginRecord[],
): Promise<DisposalFailure[]> {
  const failures: DisposalFailure[] = [];
  for (const record of [...records].reverse()) {
    if (record.status === 'disposed') continue;
    for (const disposer of [...record.context.disposers].reverse()) {
      try {
        await disposer.dispose();
      } catch (err) {
        failures.push({ pluginId: record.id, error: err });
      }
    }
    if (record.returnedDisposable !== undefined) {
      try {
        await record.returnedDisposable.dispose();
      } catch (err) {
        failures.push({ pluginId: record.id, error: err });
      }
    }
    record.status = 'disposed';
  }
  return failures;
}

export function throwDisposalError(failures: readonly DisposalFailure[]): void {
  if (failures.length > 0) {
    throw new DisposalError(failures);
  }
}
