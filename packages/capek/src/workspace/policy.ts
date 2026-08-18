/**
 * C6 workspace policy default provider and scoped service.
 *
 * `createWorkspaceService` reproduces the exact pre-C6 behavior: the
 * tool-runtime capability policy from `tools/workspace-capability.ts` and
 * the server file-access policy from the Jean2 workspace domain, unified
 * over frozen composition-time options (blocked paths, sensitive patterns,
 * home directory). The mandatory containment and sensitive/blocked
 * classification invariants are part of the default provider.
 *
 * Scope ownership: a composed agent scope gets its own service instance.
 * Consumers that run outside a composed scope (the current Jean2 server
 * path) fall back to one lazily created process-default service with the
 * exact default options, until C8 retires the compat surface.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { homedir } from 'os';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { SENSITIVE_FILE_PATTERNS } from '@capekai/types';
import type {
  WorkspaceCapability,
  WorkspaceCapabilityHost,
  WorkspaceLike,
  WorkspacePolicyOptions,
  WorkspaceService,
} from './contracts';

export const BLOCKED_PATHS = [
  '/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/dev/',
  '/proc/', '/sys/', '/root/',
];

export interface WorkspaceServiceCreateOptions {
  id?: string;
  /** Frozen composition-time options. When omitted (the process-default
   * fallback), the exact pre-C6 defaults apply: the current blocked and
   * sensitive constants and the process home directory. */
  options?: WorkspacePolicyOptions;
}

function defaultOptions(): WorkspacePolicyOptions {
  return {
    blockedPaths: BLOCKED_PATHS,
    sensitivePatterns: SENSITIVE_FILE_PATTERNS,
    homeDir: homedir(),
  };
}

// ── Mandatory containment runtime (C6 step 6) ───────────────────────────
// The tool-runtime capability is constructed HERE, not by provider methods:
// a custom provider supplies only frozen options (blocked paths, sensitive
// patterns, home directory). Containment, lexical checks, and the
// capability algorithms are non-overridable runtime evidence.

export function isLexicallyContained(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  return resolvedPath === resolvedRoot
    || resolvedPath.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : `${resolvedRoot}${sep}`);
}

function isSensitiveWith(patterns: readonly string[], candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

function isBlockedWith(blockedPaths: readonly string[], candidate: string): boolean {
  const resolvedPath = resolve(candidate);
  return blockedPaths.some((blockedPath) => resolvedPath.startsWith(blockedPath));
}

export function createWorkspaceCapabilityWithOptions(
  host: WorkspaceCapabilityHost,
  options: WorkspacePolicyOptions,
): WorkspaceCapability {
  const effectiveRoot = resolve(host.root || process.cwd());
  const additionalRoots = (host.additionalRoots ?? []).map((path) => resolve(path));
  const allowedRoots = (host.allowedRoots ?? []).map((path) => resolve(path));

  function resolvePath(path: string): string {
    if (path === '~' || path.startsWith('~/')) {
      return join(options.homeDir, path.slice(1));
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
      return isSensitiveWith(options.sensitivePatterns, path);
    },
    isBlockedPath(path: string): boolean {
      const resolvedPath = resolvePath(path);
      return isBlockedWith(options.blockedPaths, resolvedPath);
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

/** The C6 default provider wrapping the exact pre-C6 behavior. */
export function createWorkspaceService(
  createOptions: WorkspaceServiceCreateOptions = {},
): WorkspaceService {
  const id = createOptions.id ?? 'workspace.default';
  const options = createOptions.options ?? defaultOptions();

  const service: WorkspaceService = {
    id,
    options,

    expandPath(inputPath: string): string {
      let expanded = inputPath;
      if (expanded.startsWith('~/') || expanded === '~') {
        expanded = join(options.homeDir, expanded.slice(1));
      }
      return resolve(expanded);
    },

    resolvePathFor(path: string, workspacePath: string): string {
      if (path.startsWith('~/') || path === '~') {
        return join(options.homeDir, path.slice(1));
      }
      if (isAbsolute(path)) {
        return resolve(path);
      }
      return resolve(workspacePath, path);
    },

    isPathWithinWorkspace(
      targetPath: string,
      workspacePath: string,
      additionalPaths: string[] = [],
    ): boolean {
      const resolvedPath = service.resolvePathFor(targetPath, workspacePath);
      const allAllowed = [resolve(workspacePath), ...additionalPaths.map((p) => resolve(p))];
      return allAllowed.some((allowed) => {
        const relativePath = relative(allowed, resolvedPath);
        return relativePath === ''
          || (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
      });
    },

    isPathInside(child: string, parent: string): boolean {
      if (child === parent) return true;
      if (parent === sep) return true;
      return child.startsWith(parent + sep);
    },

    isInsideUnselectedAdditionalRoot(
      candidate: string,
      selectedRoot: string,
      additionalPaths: string[],
    ): boolean {
      return additionalPaths.some((path) => {
        const additionalRoot = resolve(path);
        return additionalRoot !== selectedRoot && service.isPathInside(candidate, additionalRoot);
      });
    },

    resolveCandidatePath(root: string, inputPath: string): string {
      const normalized = inputPath.replace(/\\/g, '/');
      return isAbsolute(normalized) ? resolve(normalized) : resolve(join(root, normalized));
    },

    resolveRootForQuery(
      workspace: WorkspaceLike,
      rootQuery?: string,
    ): { root: string; isMain: boolean } {
      const main = resolve(workspace.path);
      if (!rootQuery) return { root: main, isMain: true };
      const resolvedRoot = resolve(rootQuery);
      if (resolvedRoot === main) return { root: main, isMain: true };
      for (const p of workspace.additionalPaths) {
        if (resolve(p) === resolvedRoot) return { root: resolvedRoot, isMain: false };
      }
      return { root: main, isMain: true };
    },

    selectEditableRoot(
      workspace: WorkspaceLike,
      rootQuery?: string,
    ): { root: string; valid: boolean } {
      const mainRoot = resolve(workspace.path);
      if (!rootQuery) return { root: mainRoot, valid: true };

      const requestedRoot = resolve(rootQuery);
      const allowedRoots = [mainRoot, ...workspace.additionalPaths.map((path) => resolve(path))];
      if (!allowedRoots.includes(requestedRoot)) {
        return { root: mainRoot, valid: false };
      }

      return { root: requestedRoot, valid: true };
    },

    isLexicallyContained,

    isSensitivePath(path: string): boolean {
      const lower = path.toLowerCase();
      return options.sensitivePatterns.some((pattern) => lower.includes(pattern));
    },

    isBlockedPath(path: string): boolean {
      const resolvedPath = resolve(path);
      return options.blockedPaths.some((blockedPath) => resolvedPath.startsWith(blockedPath));
    },

    createCapability: (host: WorkspaceCapabilityHost): WorkspaceCapability =>
      createWorkspaceCapabilityWithOptions(host, options),
  };

  return service;
}

const scopedService = new AsyncLocalStorage<WorkspaceService>();
let processDefaultService: WorkspaceService | undefined;

/** Resolves the service seeded for the active agent scope, falling back to
 * one lazily created process-default service for consumers that run outside
 * a composed scope (the current Jean2 server path). The process default
 * carries the exact pre-C6 option defaults. */
export function getWorkspaceService(): WorkspaceService {
  return scopedService.getStore()
    ?? (processDefaultService ??= createWorkspaceService({ id: 'workspace.process-default' }));
}

/** Builds the tool-runtime capability over the active workspace policy. */
export function createWorkspaceCapability(host: WorkspaceCapabilityHost): WorkspaceCapability {
  return createWorkspaceCapabilityWithOptions(host, getWorkspaceService().options);
}

/** Seeds a service for the callback duration. `enterAgentScope` seeds the
 * composed agent scope's service here. */
export function withWorkspaceService<T>(service: WorkspaceService, callback: () => T): T {
  return scopedService.run(service, callback);
}

/** Test-only reset of the lazily created process default. Exported from this
 * module only; no package subpath re-exports it. */
export function resetDefaultWorkspaceServiceForTests(): void {
  processDefaultService = undefined;
}

// ── Compatibility free functions over the scoped service ────────────────
// The exact pre-C6 names from the Jean2 workspace domain, exported through
// the compat barrel so the server `WorkspacePathPolicyPort` adapter keeps
// one ownership of the algorithms.

/** Expands `~` to the active service's frozen home directory and resolves. */
export function expandPath(inputPath: string): string {
  return getWorkspaceService().expandPath(inputPath);
}

/** Server-style resolution over the active service. */
export function resolvePath(path: string, workspacePath: string): string {
  return getWorkspaceService().resolvePathFor(path, workspacePath);
}

export function isPathWithinWorkspace(
  targetPath: string,
  workspacePath: string,
  additionalPaths: string[] = [],
): boolean {
  return getWorkspaceService().isPathWithinWorkspace(targetPath, workspacePath, additionalPaths);
}

export function isPathInside(child: string, parent: string): boolean {
  return getWorkspaceService().isPathInside(child, parent);
}

export function isInsideUnselectedAdditionalRoot(
  candidate: string,
  selectedRoot: string,
  additionalPaths: string[],
): boolean {
  return getWorkspaceService().isInsideUnselectedAdditionalRoot(
    candidate,
    selectedRoot,
    additionalPaths,
  );
}

export function resolveCandidatePath(root: string, inputPath: string): string {
  return getWorkspaceService().resolveCandidatePath(root, inputPath);
}

export function resolveRootForQuery(
  workspace: WorkspaceLike,
  rootQuery?: string,
): { root: string; isMain: boolean } {
  return getWorkspaceService().resolveRootForQuery(workspace, rootQuery);
}

export function selectEditableRoot(
  workspace: WorkspaceLike,
  rootQuery?: string,
): { root: string; valid: boolean } {
  return getWorkspaceService().selectEditableRoot(workspace, rootQuery);
}

export type {
  WorkspacePolicy,
  WorkspacePolicyOptions,
  WorkspaceService,
} from './contracts';
