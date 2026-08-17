import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  createArborist,
  fetchPackageMetadata,
  checkVersionAge,
  resolveMaxSatisfying,
  extractIntegrity,
} from '@/services/npm-utils';
import { PROTECTED_SDK_PACKAGE } from '@/domains/tool-installation';

const PROTECTED_DEPENDENCIES = [PROTECTED_SDK_PACKAGE];

export class NpmInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NpmInstallError';
  }
}

export interface NpmInstallOptions {
  toolDir: string;
  registry?: string;
  cacheDir?: string;
}

export interface NpmInstallResult {
  success: boolean;
  installedCount: number;
  packageJson?: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
  };
  protectedVersions?: Record<string, { version: string; integrity: string | null }>;
}

export async function installDependencies(
  options: NpmInstallOptions,
): Promise<NpmInstallResult> {
  const { toolDir } = options;
  const pkgJsonPath = join(toolDir, 'package.json');

  if (!existsSync(pkgJsonPath)) {
    return {
      success: true,
      installedCount: 0,
    };
  }

  let pkgJson: { name?: string; version?: string; dependencies?: Record<string, string> };
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  } catch {
    throw new NpmInstallError(`Failed to parse package.json in ${toolDir}`);
  }

  const hasDeps =
    pkgJson.dependencies && Object.keys(pkgJson.dependencies).length > 0;

  if (!hasDeps) {
    return {
      success: true,
      installedCount: 0,
      packageJson: pkgJson,
    };
  }

  for (const dep of PROTECTED_DEPENDENCIES) {
    const range = pkgJson.dependencies![dep];
    if (range) {
      const metadata = await fetchPackageMetadata(dep);
      if (metadata) {
        const resolved = resolveMaxSatisfying(metadata, range);
        if (resolved) {
          const age = await checkVersionAge(dep, resolved);
          if (!age.ok) {
            const ageHours = Math.round(
              (Date.now() - new Date(age.publishedAt || Date.now()).getTime()) / (1000 * 60 * 60),
            );
            console.log(
              `[tools] ${dep}@${resolved} was published ${ageHours}h ago ` +
              `(minimum: ${age.minAgeHours}h) — using it anyway but consider pinning`,
            );
          }
        }
      }
    }
  }

  try {
    const arb = createArborist(toolDir, {
      registry: options.registry,
      cache: options.cacheDir,
    });

    const tree = await arb.reify();
    const installedCount = tree?.children?.size || 0;

    const protectedVersions: Record<string, { version: string; integrity: string | null }> = {};
    for (const dep of PROTECTED_DEPENDENCIES) {
      if (pkgJson.dependencies![dep]) {
        const child = tree?.children?.get(dep);
        if (child) {
          const version = (child as unknown as { package?: { version?: string } }).package?.version;
          const integrity = extractIntegrity(tree, dep);
          if (version) {
            protectedVersions[dep] = { version, integrity };
          }
        }
      }
    }

    return {
      success: true,
      installedCount,
      packageJson: pkgJson,
      protectedVersions: Object.keys(protectedVersions).length > 0 ? protectedVersions : undefined,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new NpmInstallError(
      `npm dependency install failed in ${toolDir}: ${message}`,
    );
  }
}
