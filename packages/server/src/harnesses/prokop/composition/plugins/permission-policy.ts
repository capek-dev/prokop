import type { RuntimePlugin, PluginContext } from '@/harnesses/prokop/composition/kernel/types';
import {
  createAskPermissionService,
  type AskPermissionServiceCreateOptions,
} from '@/harnesses/prokop/permission/policy';
import { createPermissionRuntimeService } from '@/harnesses/prokop/permission/runtime';
import {
  capekPermissionPolicyKey,
  capekPermissionRuntimeKey,
  capekRuntimeHostKey,
} from '@/harnesses/prokop/composition/plugins/service-keys';

/**
 * C6 providers for the permission surface:
 *
 * - `capek.permission-policy` (REPLACEABLE advice/config): the permission
 *   timeout translates into provider options here, at composition. The
 *   generic ask timeout has no current configuration source and stays the
 *   fixed 5-minute constant.
 * - `capek.permission-runtime` (NON-REPLACEABLE lifecycle): request-id
 *   routing, waiters, validation enforcement, raw-audit denial, and
 *   canonical grant construction/persistence. A replacement policy can
 *   change advice only; it can never approve malformed responses or create
 *   grants outside the canonical allowed scopes.
 */
export function permissionPolicyPlugin(id: string): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekPermissionPolicyKey, capekPermissionRuntimeKey],
    requires: [capekRuntimeHostKey],
    setup(context: PluginContext) {
      const host = context.require(capekRuntimeHostKey);
      const createOptions: AskPermissionServiceCreateOptions = {
        id,
        options: {
          askTimeoutMs: 5 * 60 * 1000,
          permissionTimeoutMs: host.interaction.getPermissionTimeoutMs(),
        },
      };
      const policy = createAskPermissionService(createOptions);
      context.provide(capekPermissionPolicyKey, policy);
      context.provide(
        capekPermissionRuntimeKey,
        createPermissionRuntimeService({ id: `${id}.runtime`, provider: policy }),
      );
    },
  };
}
