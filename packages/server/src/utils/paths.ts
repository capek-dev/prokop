/**
 * S4 compatibility re-export. The workspace path-containment policy moved
 * first to the workspace domain and, in C6 step 4, into the Capek workspace
 * policy domain, consumed here through the path policy adapter
 * (`@/adapters/capek/workspace-paths`). The pre-S4 import path and export
 * identities stay unchanged until consumers migrate.
 */

import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';

export const expandPath = workspacePathPolicyPort.expandPath;
export const isPathWithinWorkspace = workspacePathPolicyPort.isPathWithinWorkspace;
export const resolvePath = workspacePathPolicyPort.resolvePath;
export const resolveRoot = workspacePathPolicyPort.resolveRootForQuery;
