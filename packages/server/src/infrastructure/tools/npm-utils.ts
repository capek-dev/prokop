import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Arborist, { type ArboristNode } from '@npmcli/arborist';

const JEAN2_OWNED_PACKAGES = ['@jean2/client', '@jean2/sdk'];

export function getMinAgeHours(): number {
  const raw = process.env.JEAN2_PACKAGE_MIN_AGE_HOURS;
  if (raw === '0' || raw === 'false' || raw === 'off') return 0;
  const parsed = parseInt(raw || '24', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

export function isJean2OwnedPackage(packageName: string): boolean {
  return JEAN2_OWNED_PACKAGES.includes(packageName);
}

export function getRegistry(): string {
  return process.env.JEAN2_NPM_REGISTRY || 'https://registry.npmjs.org';
}

export function getDefaultNpmCacheDir(): string {
  return process.env.JEAN2_NPM_CACHE_DIR || join(homedir(), '.jean2', 'npm-cache');
}

export function resetInstallState(dir: string): void {
  const lockfilePath = join(dir, 'package-lock.json');
  if (existsSync(lockfilePath)) {
    rmSync(lockfilePath);
  }

  const nodeModulesPath = join(dir, 'node_modules');
  if (existsSync(nodeModulesPath)) {
    rmSync(nodeModulesPath, { recursive: true, force: true });
  }
}

/** @deprecated Use resetInstallState instead */
export function clearLockfile(dir: string): void {
  resetInstallState(dir);
}

export function createArborist(dir: string, extra?: { registry?: string; cache?: string }): Arborist {
  resetInstallState(dir);

  return new Arborist({
    path: dir,
    registry: extra?.registry || getRegistry(),
    cache: extra?.cache || getDefaultNpmCacheDir(),
    preferOnline: true,
  });
}

interface PackageMetadata {
  distTags: Record<string, string>;
  time: Record<string, string>;
  versions: Record<string, unknown>;
}

export async function fetchPackageMetadata(packageName: string): Promise<PackageMetadata | null> {
  const registry = getRegistry();
  const url = `${registry.replace(/\/$/, '')}/${packageName}`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json() as {
      'dist-tags'?: Record<string, string>;
      time?: Record<string, string>;
      versions?: Record<string, unknown>;
    };
    return {
      distTags: data['dist-tags'] || {},
      time: data.time || {},
      versions: data.versions || {},
    };
  } catch {
    return null;
  }
}

export interface VersionAgeResult {
  ok: boolean;
  publishedAt: string | null;
  minAgeHours: number;
}

export async function checkVersionAge(
  packageName: string,
  version: string,
): Promise<VersionAgeResult> {
  const minAgeHours = getMinAgeHours();

  if (minAgeHours === 0) {
    return { ok: true, publishedAt: null, minAgeHours: 0 };
  }

  const metadata = await fetchPackageMetadata(packageName);
  if (!metadata) {
    return { ok: false, publishedAt: null, minAgeHours };
  }

  const publishedAt = metadata.time[version];
  if (!publishedAt) {
    return { ok: false, publishedAt: null, minAgeHours };
  }

  const publishTime = new Date(publishedAt).getTime();
  const ageMs = Date.now() - publishTime;
  const ageHours = ageMs / (1000 * 60 * 60);

  return {
    ok: ageHours >= minAgeHours,
    publishedAt,
    minAgeHours,
  };
}

export function resolveMaxSatisfying(
  metadata: PackageMetadata,
  range: string,
): string | null {
  const { versions, distTags } = metadata;

  const latest = distTags.latest;
  if (!latest) return null;

  const parseRange = (r: string): (v: string) => boolean => {
    if (r === 'latest' || r === '*' || r === '') {
      return () => true;
    }

    const caretMatch = r.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
    if (caretMatch) {
      const [, maj, min, patch] = caretMatch.map(Number);
      return (v: string) => {
        const parts = v.split('.').map(Number);
        if (parts.length < 3) return false;
        const [vmaj, vmin] = parts;
        if (vmaj !== maj) return false;
        if (vmaj === 0) {
          if (vmin !== min) return false;
          return parts[2] >= patch;
        }
        return vmin >= min && (vmin > min || parts[2] >= patch);
      };
    }

    const exactMatch = r.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (exactMatch) {
      return (v: string) => v === r;
    }

    return (v: string) => v === r;
  };

  const satisfies = parseRange(range);
  const available = Object.keys(versions).filter(v => versions[v] && satisfies(v));

  const sorted = available.sort((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    }
    return 0;
  });

  return sorted.pop() ?? null;
}

export interface VersionLock {
  packageName: string;
  version: string;
  integrity: string;
}

export function extractIntegrity(
  tree: ArboristNode | null | undefined,
  packageName: string,
): string | null {
  const child = tree?.children?.get(packageName);
  if (!child) return null;
  return child.package?.dist?.integrity ?? null;
}
