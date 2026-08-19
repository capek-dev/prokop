/**
 * Public workspace policy entrypoint (`@capekai/core/workspace`).
 *
 * Exposes exactly the workspace path policy identities the Jean2 server
 * consumes through its workspace-paths adapter: containment and
 * classification algorithms plus the service constructors. Every symbol
 * resolves to the owning module's identity, identical to the compatibility
 * barrel. S8a.
 */

export {
  expandPath,
  isInsideUnselectedAdditionalRoot,
  isPathInside,
  isPathWithinWorkspace,
  resolveCandidatePath,
  resolvePath,
  resolveRootForQuery,
  selectEditableRoot,
} from '../workspace/policy';
export type {
  WorkspacePolicy,
  WorkspacePolicyOptions,
  WorkspaceService,
} from '../workspace/contracts';
