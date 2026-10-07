import type { RuntimePlugin, PluginContext } from '@/harnesses/prokop/composition/kernel/types';
import type { WorkspacePolicyOptions } from '@/infrastructure/filesystem/workspace-policy/contracts';
import { createWorkspaceService } from '@/infrastructure/filesystem/workspace-policy/policy';
import { capekWorkspacePolicyKey } from '@/harnesses/prokop/composition/plugins/service-keys';

/**
 * C6 provider for the agent-scoped workspace policy service
 * (`capek.workspace-policy`). The path inputs translate into provider
 * options here, at composition: the blocked-path list, the sensitive
 * pattern list, and the home directory freeze into the service options, so
 * no runtime code re-reads them. The default provider reproduces the exact
 * current containment, root classification, expansion, and sensitive/blocked
 * denial behavior.
 */
export function workspacePolicyPlugin(
  id: string,
  options?: WorkspacePolicyOptions,
): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekWorkspacePolicyKey],
    setup(context: PluginContext) {
      context.provide(
        capekWorkspacePolicyKey,
        createWorkspaceService({ id, options }),
      );
    },
  };
}
