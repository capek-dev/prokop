import { jean2ToolCatalog } from '@/adapters/capek/tool-source';
import { listToolEnvVars, setToolEnvVar } from '@/config/tool-env';
import {
  ConfigurationPersistenceError,
  ConfigurationValidationError,
} from '@/config/errors';
import type {
  ToolCatalogPort,
  ToolEnvironmentPort,
  ToolEnvListPortResult,
  ToolEnvSetPortResult,
} from '@/application/ports/tool-catalog';

/**
 * Jean2 tool catalog and environment adapters (S4). The catalog delegates
 * to the Čapek runtime catalog; the environment adapter
 * wraps the configuration env-var implementation and translates its errors
 * into port-level results so the application never imports configuration
 * error classes.
 */

export function createJean2ToolCatalogPort(): ToolCatalogPort {
  return {
    listTools: jean2ToolCatalog.listTools,
    getTool: jean2ToolCatalog.getTool,
  };
}

export function createJean2ToolEnvironmentPort(): ToolEnvironmentPort {
  return {
    async listToolEnvVars(): Promise<ToolEnvListPortResult> {
      try {
        const status = await listToolEnvVars();
        return { ok: true, status };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, message };
      }
    },

    async setToolEnvVar(key, value): Promise<ToolEnvSetPortResult> {
      try {
        const envVar = await setToolEnvVar(key, value);
        return { ok: true, envVar };
      } catch (err: unknown) {
        if (err instanceof ConfigurationValidationError) {
          return { ok: false, kind: 'invalid', message: err.message };
        }
        if (err instanceof ConfigurationPersistenceError) {
          return { ok: false, kind: 'failed', message: err.message };
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, kind: 'failed', message };
      }
    },
  };
}
