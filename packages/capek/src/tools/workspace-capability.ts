import { homedir } from 'os';
import { isAbsolute, join, resolve, sep } from 'path';
import { SENSITIVE_FILE_PATTERNS } from '@jean2/sdk';

const BLOCKED_PATHS = [
  '/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/dev/',
  '/proc/', '/sys/', '/root/',
];

export interface WorkspaceCapabilityHost {
  root?: string;
  additionalRoots?: string[];
  allowedRoots?: string[];
  tempDir: string;
  getEnvironmentValue?: (key: string) => string | undefined;
  addAdditionalRoot?: (path: string) => boolean | Promise<boolean>;
  removeAdditionalRoot?: (path: string) => boolean | Promise<boolean>;
}

export interface WorkspaceCapability {
  effectiveRoot: string;
  additionalRoots: string[];
  allowedRoots: string[];
  tempDir: string;
  resolvePath(path: string): string;
  isWithinWorkspace(path: string): boolean;
  isSensitivePath(path: string): boolean;
  isBlockedPath(path: string): boolean;
  getEnvironmentValue(key: string): string | undefined;
  addWorkspacePath(path: string): Promise<boolean>;
  removeWorkspacePath(path: string): Promise<boolean>;
}

export function isLexicallyContained(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  return resolvedPath === resolvedRoot
    || resolvedPath.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`);
}

export function createWorkspaceCapability(host: WorkspaceCapabilityHost): WorkspaceCapability {
  const effectiveRoot = resolve(host.root || process.cwd());
  const additionalRoots = (host.additionalRoots ?? []).map((path) => resolve(path));
  const allowedRoots = (host.allowedRoots ?? []).map((path) => resolve(path));

  function resolvePath(path: string): string {
    if (path === '~' || path.startsWith('~/')) {
      return join(homedir(), path.slice(1));
    }
    if (isAbsolute(path)) {
      return resolve(path);
    }
    return resolve(effectiveRoot, path);
  }

  return {
    effectiveRoot,
    additionalRoots,
    allowedRoots,
    tempDir: host.tempDir,
    resolvePath,
    isWithinWorkspace(path: string): boolean {
      const resolvedPath = resolvePath(path);
      return [effectiveRoot, ...additionalRoots]
        .some((root) => isLexicallyContained(resolvedPath, root));
    },
    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return SENSITIVE_FILE_PATTERNS.some((pattern) => lower.includes(pattern));
    },
    isBlockedPath(path: string): boolean {
      const resolvedPath = resolvePath(path);
      return BLOCKED_PATHS.some((blockedPath) => resolvedPath.startsWith(blockedPath));
    },
    getEnvironmentValue(key: string): string | undefined {
      return host.getEnvironmentValue?.(key) ?? process.env[key];
    },
    async addWorkspacePath(path: string): Promise<boolean> {
      if (!host.addAdditionalRoot) return false;
      return host.addAdditionalRoot(resolve(path));
    },
    async removeWorkspacePath(path: string): Promise<boolean> {
      if (!host.removeAdditionalRoot) return false;
      return host.removeAdditionalRoot(resolve(path));
    },
  };
}
