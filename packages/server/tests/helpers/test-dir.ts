import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Paths, getModelsConfigPath } from '@/infrastructure/runtime/paths';
import { clearConfigCache, clearModelsCache } from '@/config';
import defaultModelsJson from '@/config/models.json';

let activeTestDir: string | null = null;

/**
 * Create a temporary data directory and configure Paths to use it.
 * All path functions (getAuthTokenPath, getPreconfigsDir, etc.) will
 * resolve under this temporary directory.
 *
 * Seeds a default models.json so config endpoints work.
 *
 * Call resetTestDataDir() in afterEach() to clean up.
 */
export function setupTestDataDir(): string {
  clearConfigCache();
  clearModelsCache();

  const testDir = join(tmpdir(), `jean2-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
  Paths.configure({ dataDir: testDir });
  activeTestDir = testDir;

  // Seed default models config so /api/config/models works
  writeFileSync(getModelsConfigPath(), JSON.stringify(defaultModelsJson, null, 2));

  return testDir;
}

/**
 * Reset the Paths override and remove the temp directory.
 * Call this in afterEach().
 */
export function resetTestDataDir(): void {
  clearConfigCache();
  clearModelsCache();
  Paths.reset();
  if (activeTestDir) {
    try {
      rmSync(activeTestDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
    activeTestDir = null;
  }
}

/**
 * Get the active test data directory (if set).
 */
export function getTestDataDir(): string | null {
  return activeTestDir;
}
