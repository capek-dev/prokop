/** Minimal composition fixture for isolated runtime tests. */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentScope } from '@/harnesses/prokop/composition/kernel/kernel';
import type { AgentScopeHandle, ProcessScopeHandle } from '@/harnesses/prokop/composition/kernel/types';
import { withRuntimeHost, getRuntimeHost, type RuntimeHost } from '@/infrastructure/runtime/host';
import { createStandaloneHost } from './standalone-host';
import { createFacadeAgentPlugins, type FacadeScopeValues } from './facade-plugins';

export { facadeProcessPlugins } from './facade-plugins';
export { createAgentScope, createProcessScope, enterAgentScope } from '@/harnesses/prokop/composition/plugins/compose';

export interface Composition {
  readonly processScope: ProcessScopeHandle;
  readonly agentScope: AgentScopeHandle;
}

/** Composes one agent scope above an explicit process scope using the
 * package's curated plugin set. The C6 policy providers read the ambient
 * runtime host (tool-output temp root) at activation, so composition runs
 * inside `withRuntimeHost`; when no host is configured ambiently, the
 * reference standalone host is installed for the composition's duration.
 * The caller owns both scopes' lifetimes:
 * `await composition.agentScope.dispose()` and
 * `await composition.processScope.dispose()` when done. Multiple agent
 * scopes may share one process scope concurrently. */
export async function createComposition(
  processScope: ProcessScopeHandle,
  values: FacadeScopeValues,
): Promise<Composition> {
  let ambient: RuntimeHost | undefined;
  try {
    ambient = getRuntimeHost();
  } catch {
    // No ambient host configured; the reference standalone host covers
    // composition-time activation reads (tool-output temp root).
    ambient = undefined;
  }
  return withRuntimeHost(ambient ?? createStandaloneHost({
    workspace: process.cwd(),
    sandboxActive: false,
    tempRoot: join(tmpdir(), 'capek-composition'),
  }), () =>
    createAgentScope(
      processScope,
      [...createFacadeAgentPlugins(values)],
    ).then((agentScope): Composition => ({ processScope, agentScope })));
}
