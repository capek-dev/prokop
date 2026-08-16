/**
 * C6 pinned compatibility forwarder. The workspace capability policy and
 * host contract moved to the workspace domain (`workspace/contracts.ts`
 * owns the types; `workspace/policy.ts` owns the scoped service and the
 * module-level containment runtime). Every prior export resolves to the
 * same identity, so `core/tool-builders/external-tools.ts`, `runtime/host.ts`,
 * and `compat/jean2.ts` keep working unchanged until C8 retires the compat
 * surface.
 *
 * C6 step 6: capability construction is runtime code. The active provider
 * supplies only its frozen options (blocked paths, sensitive patterns,
 * home directory); the containment and classification algorithms are the
 * module-level non-overridable functions, so a custom provider cannot
 * broaden workspace roots or disable containment through its methods.
 */

import type {
  WorkspaceCapability,
  WorkspaceCapabilityHost,
} from '../workspace/contracts';
import {
  createWorkspaceCapabilityWithOptions,
  getWorkspaceService,
  isLexicallyContained as isLexicallyContainedRuntime,
} from '../workspace/policy';

export type {
  WorkspaceCapability,
  WorkspaceCapabilityHost,
} from '../workspace/contracts';

export function isLexicallyContained(path: string, root: string): boolean {
  return isLexicallyContainedRuntime(path, root);
}

export function createWorkspaceCapability(host: WorkspaceCapabilityHost): WorkspaceCapability {
  return createWorkspaceCapabilityWithOptions(host, getWorkspaceService().options);
}
