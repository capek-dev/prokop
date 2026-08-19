import { isAbsolute, join, resolve } from 'path';
import {
  expandPath as serviceExpandPath,
  isInsideUnselectedAdditionalRoot,
  isPathInside,
  isPathWithinWorkspace,
  resolveCandidatePath,
  resolvePath as serviceResolvePath,
  resolveRootForQuery,
  selectEditableRoot,
} from '@capekai/core/workspace';
import type { WorkspacePathPolicyPort } from '@/application/ports/workspace-paths';

/**
 * Capek workspace path policy adapter (S5, paired with C6 step 4). The
 * containment and classification algorithms live in the Capek workspace
 * domain; this adapter fulfills the inward-facing
 * `WorkspacePathPolicyPort` through the compat barrel, so the server file
 * services and the tool runtime share one policy.
 *
 * The module singleton below is the compatibility access point for the
 * legacy service modules (`services/files.ts`, `services/fileMutations.ts`,
 * `services/filePreview.ts`, `utils/paths.ts`); it resolves the process
 * default Capek workspace service, which carries the exact pre-C6 option
 * defaults. It retires with the compat surface in C8.
 *
 * The optional `home` parameters on `expandPath` and `resolvePath` retain
 * the exact pre-C6 server signature (the retired workspace-domain functions
 * accepted `home?: string` defaulting to the process home directory). The
 * scoped provider keeps ownership of the default home; these overrides only
 * substitute the caller-supplied value for one call.
 */
function expandPath(inputPath: string, home?: string): string {
  if (home === undefined) return serviceExpandPath(inputPath);
  let expanded = inputPath;
  if (expanded.startsWith('~/') || expanded === '~') {
    expanded = join(home, expanded.slice(1));
  }
  return resolve(expanded);
}

function resolvePath(path: string, workspacePath: string, home?: string): string {
  if (home === undefined) return serviceResolvePath(path, workspacePath);
  if (path.startsWith('~/') || path === '~') {
    return join(home, path.slice(1));
  }
  if (isAbsolute(path)) {
    return resolve(path);
  }
  return resolve(workspacePath, path);
}

export function createWorkspacePathPolicyPort(): WorkspacePathPolicyPort {
  return {
    expandPath,
    resolvePath,
    isPathWithinWorkspace,
    isPathInside,
    isInsideUnselectedAdditionalRoot,
    resolveCandidatePath,
    resolveRootForQuery,
    selectEditableRoot,
  };
}

/** Compatibility singleton for legacy server service consumers. */
export const workspacePathPolicyPort: WorkspacePathPolicyPort =
  createWorkspacePathPolicyPort();
