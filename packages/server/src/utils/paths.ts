/**
 * S4 compatibility re-export: the workspace path-containment policy moved to
 * the workspace domain (`@/domains/workspaces/file-access`). The pre-S4
 * import path and export identities stay unchanged until consumers migrate.
 */
export {
  expandPath,
  isPathWithinWorkspace,
  resolvePath,
  resolveRootForQuery as resolveRoot,
} from '@/domains/workspaces';
