import type { CapekPlugin, PluginContext } from '../kernel/types';
import { homedir } from 'os';
import { SENSITIVE_FILE_PATTERNS } from '@capekai/types';
import {
  BLOCKED_PATHS,
  createWorkspaceService,
  type WorkspacePolicyOptions,
} from '../workspace/policy';
import { capekWorkspacePolicyKey } from './service-keys';

/**
 * C6 provider for the agent-scoped workspace policy service
 * (`capek.workspace-policy`). The path inputs translate into provider
 * options here, at composition: the blocked-path list, the sensitive
 * pattern list, and the home directory freeze into the service options, so
 * no runtime code re-reads them. The default provider reproduces the exact
 * current containment, root classification, expansion, and sensitive/blocked
 * denial behavior.
 */
export function workspacePolicyPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekWorkspacePolicyKey],
    setup(context: PluginContext) {
      const options: WorkspacePolicyOptions = {
        blockedPaths: [...BLOCKED_PATHS],
        sensitivePatterns: [...SENSITIVE_FILE_PATTERNS],
        homeDir: homedir(),
      };
      context.provide(
        capekWorkspacePolicyKey,
        createWorkspaceService({ id, options }),
      );
    },
  };
}
