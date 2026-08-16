import type { CapekPlugin } from '../kernel/types';
import { DefaultAgentDriver } from '../runtime/default-agent-driver';
import { capekAgentDriverKey } from './service-keys';

export function defaultAgentDriverPlugin(id: string): CapekPlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekAgentDriverKey],
    setup(context) {
      context.provide(capekAgentDriverKey, new DefaultAgentDriver());
    },
  };
}
