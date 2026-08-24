import {
  cpSync,
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { clearConfigCache, resolveDatabasePath } from '@/config';
import { reloadJean2Env, wasEnvInjectedFromFile } from '@/infrastructure/runtime/environment';
import { getDataDir, Paths, LEGACY_JEAN2_DIR_NAME, PROKOPAI_DIR_NAME } from '@/infrastructure/runtime/paths';
import {
  checkpointDatabase,
  rewriteWorkspacePathsForRename,
  validateDatabase,
} from '@/infrastructure/sqlite/rename-migration';

export interface RenameMigrationResult {
  success: boolean;
  error?: string;
  backupPath?: string;
  steps: RenameMigrationStepResult[];
}

export interface RenameMigrationStepResult {
  step: string;
  status: 'done' | 'skipped' | 'failed';
  detail?: string;
}

export interface RenameMigrationOptions {
  skipDirMove?: boolean;
  legacyDataDir?: string;
  canonicalDataDir?: string;
  timestamp?: string;
}

function rewriteLegacyPath(value: string, legacyDataDir: string, canonicalDataDir: string): string {
  const quote = value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')
    ? value[0]
    : '';
  const unquoted = quote ? value.slice(1, -1) : value;
  const isLegacyPath = unquoted === legacyDataDir
    || unquoted.startsWith(`${legacyDataDir}/`)
    || unquoted.startsWith(`${legacyDataDir}\\`);
  if (!isLegacyPath) return value;

  const rewritten = canonicalDataDir + unquoted.slice(legacyDataDir.length);
  return quote ? `${quote}${rewritten}${quote}` : rewritten;
}

function isWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(resolve(parent), resolve(candidate));
  return pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent));
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export async function isProkopServerReachable(dataDir = getDataDir()): Promise<boolean> {
  try {
    const config = readJsonObject(join(dataDir, 'config.json'));
    const port = typeof config?.port === 'number' ? config.port : 8742;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === 'object'
      && body !== null
      && 'status' in body
      && body.status === 'healthy';
  } catch {
    return false;
  }
}

function resolveSourceDatabasePath(
  sourceDir: string,
  legacyDataDir: string,
  canonicalDataDir: string,
): string {
  const config = readJsonObject(join(sourceDir, 'config.json'));
  const envValues = readDataDirEnv(sourceDir);
  const envDatabasePath = envValues.get('PROKOPAI_DATABASE_PATH')
    ?? envValues.get('JEAN2_DATABASE_PATH');
  const configuredPath = envDatabasePath ?? config?.databasePath;
  const rawDatabasePath = typeof configuredPath === 'string'
    ? configuredPath
    : join(sourceDir, 'data', 'agent.db');
  const databasePath = sourceDir === canonicalDataDir
    ? rewriteLegacyPath(rawDatabasePath, legacyDataDir, canonicalDataDir)
    : rawDatabasePath;
  if (!isWithin(sourceDir, databasePath)) {
    throw new Error(`databasePath must be inside ${sourceDir}; external database paths are not migrated`);
  }
  return databasePath;
}

const PATH_ENV_KEYS = [
  'PROKOPAI_DATA_DIR',
  'JEAN2_DATA_DIR',
  'PROKOPAI_DATABASE_PATH',
  'JEAN2_DATABASE_PATH',
  'PROKOPAI_TOOLS_PATH',
  'JEAN2_TOOLS_PATH',
  'PROKOPAI_MODELS_PATH',
  'JEAN2_MODELS_PATH',
  'PROKOPAI_PRECONFIGS_PATH',
  'JEAN2_PRECONFIGS_PATH',
] as const;

function readDataDirEnv(dataDir: string): Map<string, string> {
  const values = new Map<string, string>();
  const envPath = join(dataDir, '.env');
  if (!existsSync(envPath)) return values;

  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const value = rawValue.length >= 2
      && ((rawValue.startsWith('"') && rawValue.endsWith('"'))
        || (rawValue.startsWith("'") && rawValue.endsWith("'")))
      ? rawValue.slice(1, -1)
      : rawValue;
    values.set(key, value);
  }
  return values;
}

function findRedirectingEnvironment(sourceDir: string): string[] {
  const fileValues = readDataDirEnv(sourceDir);
  return PATH_ENV_KEYS.filter((key) => {
    const processValue = process.env[key];
    return processValue !== undefined
      && (!wasEnvInjectedFromFile(key) || processValue !== fileValues.get(key));
  });
}

function findInvalidDataDirValues(
  sourceDir: string,
  legacyDataDir: string,
  canonicalDataDir: string,
): string[] {
  const fileValues = readDataDirEnv(sourceDir);
  return ['PROKOPAI_DATA_DIR', 'JEAN2_DATA_DIR'].filter((key) => {
    const value = fileValues.get(key);
    return value !== undefined
      && resolve(value) !== resolve(legacyDataDir)
      && resolve(value) !== resolve(canonicalDataDir);
  });
}

function migrateConfigPaths(
  dataDir: string,
  legacyDataDir: string,
  canonicalDataDir: string,
  required = true,
): RenameMigrationStepResult {
  const configPath = join(dataDir, 'config.json');
  if (!existsSync(configPath)) {
    return {
      step: 'config-paths',
      status: required ? 'failed' : 'skipped',
      detail: 'config.json is missing',
    };
  }

  try {
    const config = readJsonObject(configPath)!;
    let rewritten = 0;
    for (const key of ['databasePath', 'toolsPath']) {
      const value = config[key];
      if (typeof value !== 'string') continue;
      const migrated = rewriteLegacyPath(value, legacyDataDir, canonicalDataDir);
      if (migrated !== value) {
        config[key] = migrated;
        rewritten++;
      }
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return {
      step: 'config-paths',
      status: rewritten > 0 ? 'done' : 'skipped',
      detail: rewritten > 0 ? `rewrote ${rewritten} paths` : 'no legacy paths found',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { step: 'config-paths', status: 'failed', detail: message };
  }
}

function migrateEnvFileKeys(
  dataDir: string,
  legacyDataDir: string,
  canonicalDataDir: string,
): RenameMigrationStepResult {
  const envPath = join(dataDir, '.env');
  if (!existsSync(envPath)) {
    return { step: 'env-keys', status: 'skipped', detail: 'no .env file' };
  }

  try {
    const content = readFileSync(envPath, 'utf-8');
    let rewritten = 0;
    const updated = content
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) return line;
        const key = trimmed.slice(0, eqIndex);
        const value = trimmed.slice(eqIndex + 1);
        const migratedKey = key.startsWith('JEAN2_')
          ? `PROKOPAI_${key.slice('JEAN2_'.length)}`
          : key;
        const migratedValue = rewriteLegacyPath(value, legacyDataDir, canonicalDataDir);
        if (migratedKey === key && migratedValue === value) return line;
        rewritten++;
        return `${migratedKey}=${migratedValue}`;
      })
      .join('\n');

    if (rewritten === 0) {
      return { step: 'env-keys', status: 'skipped', detail: 'no legacy keys or paths found' };
    }
    writeFileSync(envPath, updated, 'utf-8');
    return { step: 'env-keys', status: 'done', detail: `rewrote ${rewritten} entries` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { step: 'env-keys', status: 'failed', detail: message };
  }
}

function migrateAgentHomeDirs(dataDir: string): RenameMigrationStepResult {
  const agentsRoot = join(dataDir, 'agents');
  if (!existsSync(agentsRoot)) {
    return { step: 'agent-homes', status: 'skipped', detail: 'no agents directory' };
  }

  let renamed = 0;
  const failures: string[] = [];
  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const legacy = join(agentsRoot, entry.name, 'home', LEGACY_JEAN2_DIR_NAME);
    if (!existsSync(legacy)) continue;
    const canonical = join(agentsRoot, entry.name, 'home', PROKOPAI_DIR_NAME);
    if (existsSync(canonical)) {
      failures.push(`${legacy} (canonical exists)`);
      continue;
    }
    try {
      renameSync(legacy, canonical);
      renamed++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push(`${legacy}: ${message}`);
    }
  }

  if (failures.length > 0) {
    return { step: 'agent-homes', status: 'failed', detail: failures.join('; ') };
  }
  return {
    step: 'agent-homes',
    status: renamed > 0 ? 'done' : 'skipped',
    detail: renamed > 0 ? `renamed ${renamed}` : 'no legacy agent home dirs',
  };
}

function migrateWorkspacePaths(
  databasePath: string,
  legacyDataDir: string,
  canonicalDataDir: string,
): RenameMigrationStepResult {
  const result = rewriteWorkspacePathsForRename(databasePath, legacyDataDir, canonicalDataDir);
  return { step: 'workspace-paths', status: result.status, detail: result.detail };
}

function failedResult(steps: RenameMigrationStepResult[], step: string, detail: string): RenameMigrationResult {
  steps.push({ step, status: 'failed', detail });
  return { success: false, error: `${step}: ${detail}`, steps };
}

function runInPlaceMigration(dataDir: string, legacyHome: string, canonicalHome: string): RenameMigrationResult {
  const steps: RenameMigrationStepResult[] = [
    { step: 'stage', status: 'skipped', detail: 'directory staging skipped by option' },
  ];
  steps.push(migrateConfigPaths(dataDir, legacyHome, canonicalHome, false));
  steps.push(migrateEnvFileKeys(dataDir, legacyHome, canonicalHome));
  steps.push(migrateAgentHomeDirs(dataDir));
  const dbPath = join(dataDir, 'data', 'agent.db');
  const workspaceStep = existsSync(dbPath)
    ? migrateWorkspacePaths(dbPath, legacyHome, canonicalHome)
    : { step: 'workspace-paths', status: 'skipped', detail: 'no database file' } as RenameMigrationStepResult;
  steps.push(workspaceStep);
  const failed = steps.filter((step) => step.status === 'failed');
  return {
    success: failed.length === 0,
    error: failed.map((step) => `${step.step}: ${step.detail}`).join('; ') || undefined,
    steps,
  };
}

export function runProkopaiRenameMigration(options?: RenameMigrationOptions): RenameMigrationResult {
  const legacyHome = options?.legacyDataDir ?? join(homedir(), LEGACY_JEAN2_DIR_NAME);
  const canonicalHome = options?.canonicalDataDir ?? join(homedir(), PROKOPAI_DIR_NAME);
  if (options?.skipDirMove) {
    return runInPlaceMigration(getDataDir(), legacyHome, canonicalHome);
  }

  const steps: RenameMigrationStepResult[] = [];
  const legacyExists = existsSync(legacyHome);
  const canonicalExists = existsSync(canonicalHome);
  if (legacyExists && canonicalExists) {
    return failedResult(steps, 'preflight', `${legacyHome} and ${canonicalHome} both exist; neither was changed`);
  }
  if (!legacyExists && !canonicalExists) {
    return failedResult(steps, 'preflight', `legacy data directory not found: ${legacyHome}`);
  }

  const sourceHome = legacyExists ? legacyHome : canonicalHome;
  const repairMode = sourceHome === canonicalHome;
  const redirectingEnvironment = findRedirectingEnvironment(sourceHome);
  if (redirectingEnvironment.length > 0) {
    return failedResult(
      steps,
      'preflight',
      `unset path overrides before migration: ${redirectingEnvironment.join(', ')}`,
    );
  }
  const invalidDataDirValues = findInvalidDataDirValues(sourceHome, legacyHome, canonicalHome);
  if (invalidDataDirValues.length > 0) {
    return failedResult(
      steps,
      'preflight',
      `data-directory overrides must point to ${legacyHome} or ${canonicalHome}: ${invalidDataDirValues.join(', ')}`,
    );
  }
  steps.push({ step: 'preflight', status: 'done', detail: 'startup path inputs are safe' });

  const timestamp = options?.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const stagingDir = `${canonicalHome}.migration-staging`;
  const backupPath = repairMode
    ? `${canonicalHome}.pre-prokop-repair-${timestamp}`
    : `${legacyHome}.pre-prokop-migration-${timestamp}`;
  if (existsSync(stagingDir)) {
    return failedResult(steps, 'preflight', `staging directory already exists: ${stagingDir}`);
  }
  if (existsSync(backupPath)) {
    return failedResult(steps, 'preflight', `backup path already exists: ${backupPath}`);
  }

  let sourceDatabasePath: string;
  try {
    sourceDatabasePath = resolveSourceDatabasePath(sourceHome, legacyHome, canonicalHome);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failedResult(steps, 'preflight', message);
  }

  const checkpoint = checkpointDatabase(sourceDatabasePath);
  if (!checkpoint.success) return failedResult(steps, 'database-checkpoint', checkpoint.detail);
  steps.push({ step: 'database-checkpoint', status: 'done', detail: checkpoint.detail });

  const sourceValidation = validateDatabase(sourceDatabasePath);
  if (!sourceValidation.success) return failedResult(steps, 'source-validation', sourceValidation.detail);
  steps.push({ step: 'source-validation', status: 'done', detail: sourceValidation.detail });

  try {
    cpSync(sourceHome, stagingDir, { recursive: true, errorOnExist: true, force: false });
    steps.push({ step: 'stage', status: 'done', detail: `copied ${sourceHome} to ${stagingDir}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failedResult(steps, 'stage', message);
  }

  const relativeDatabasePath = relative(sourceHome, sourceDatabasePath);
  const stagedDatabasePath = join(stagingDir, relativeDatabasePath);
  const canonicalDatabasePath = join(canonicalHome, relativeDatabasePath);

  steps.push(migrateConfigPaths(stagingDir, legacyHome, canonicalHome));
  steps.push(migrateEnvFileKeys(stagingDir, legacyHome, canonicalHome));
  steps.push(migrateAgentHomeDirs(stagingDir));
  steps.push(migrateWorkspacePaths(stagedDatabasePath, legacyHome, canonicalHome));
  const rewriteFailure = steps.find((step) => step.status === 'failed');
  if (rewriteFailure) {
    return {
      success: false,
      error: `${rewriteFailure.step}: ${rewriteFailure.detail}`,
      steps,
    };
  }

  const stagedCheckpoint = checkpointDatabase(stagedDatabasePath);
  if (!stagedCheckpoint.success) return failedResult(steps, 'staged-validation', stagedCheckpoint.detail);
  const stagedValidation = validateDatabase(stagedDatabasePath);
  if (!stagedValidation.success) return failedResult(steps, 'staged-validation', stagedValidation.detail);
  steps.push({ step: 'staged-validation', status: 'done', detail: stagedValidation.detail });

  const finalSourceCheckpoint = checkpointDatabase(sourceDatabasePath);
  if (!finalSourceCheckpoint.success) {
    return failedResult(steps, 'source-stability', finalSourceCheckpoint.detail);
  }
  const finalSourceValidation = validateDatabase(sourceDatabasePath);
  if (!finalSourceValidation.success || finalSourceValidation.fingerprint !== sourceValidation.fingerprint) {
    return failedResult(steps, 'source-stability', 'source database changed during migration; staging was not activated');
  }
  steps.push({ step: 'source-stability', status: 'done', detail: 'source database remained unchanged' });

  if (!repairMode && existsSync(canonicalHome)) {
    return failedResult(steps, 'activate', `${canonicalHome} appeared during migration; source remains unchanged`);
  }

  try {
    if (repairMode) {
      renameSync(canonicalHome, backupPath);
      try {
        renameSync(stagingDir, canonicalHome);
      } catch (err: unknown) {
        renameSync(backupPath, canonicalHome);
        throw err;
      }
    } else {
      renameSync(stagingDir, canonicalHome);
      try {
        renameSync(legacyHome, backupPath);
      } catch (err: unknown) {
        renameSync(canonicalHome, stagingDir);
        throw err;
      }
    }
    steps.push({ step: 'activate', status: 'done', detail: `activated ${canonicalHome}` });
    steps.push({ step: 'backup', status: 'done', detail: `retained source at ${backupPath}` });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return failedResult(steps, 'activate', message);
  }

  try {
    for (const key of PATH_ENV_KEYS) delete process.env[key];
    if (options?.legacyDataDir !== undefined || options?.canonicalDataDir !== undefined) {
      Paths.configure({ dataDir: canonicalHome });
    } else {
      Paths.reset();
    }
    clearConfigCache();
    reloadJean2Env();
    if (resolve(getDataDir()) !== resolve(canonicalHome)) {
      throw new Error(`startup data directory resolves ${getDataDir()}, expected ${canonicalHome}`);
    }
    const resolvedDatabasePath = resolveDatabasePath();
    if (resolve(resolvedDatabasePath) !== resolve(canonicalDatabasePath)) {
      throw new Error(`startup resolves ${resolvedDatabasePath}, expected ${canonicalDatabasePath}`);
    }
    const activatedValidation = validateDatabase(resolvedDatabasePath);
    if (!activatedValidation.success) throw new Error(activatedValidation.detail);
    if (activatedValidation.fingerprint !== stagedValidation.fingerprint) {
      throw new Error('activated database fingerprint does not match the validated staged database');
    }
    steps.push({ step: 'startup-validation', status: 'done', detail: `startup resolves ${resolvedDatabasePath}` });
    return { success: true, backupPath, steps };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const failedCanonical = `${stagingDir}.failed-${timestamp}`;
    try {
      renameSync(canonicalHome, failedCanonical);
      renameSync(backupPath, sourceHome);
      if (options?.legacyDataDir !== undefined || options?.canonicalDataDir !== undefined) {
        Paths.configure({ dataDir: sourceHome });
      } else {
        Paths.reset();
      }
      clearConfigCache();
      reloadJean2Env();
    } catch (rollbackErr: unknown) {
      const rollbackMessage = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      return failedResult(steps, 'startup-validation', `${message}; rollback failed: ${rollbackMessage}`);
    }
    return failedResult(steps, 'startup-validation', `${message}; restored ${sourceHome}`);
  }
}
