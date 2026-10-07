import type { RuntimePlugin } from '@/harnesses/prokop/composition/kernel/types';
import { DefaultAgentDriver } from '@/harnesses/prokop/execution/default-agent-driver';
import { capekAgentDriverKey } from '@/harnesses/prokop/composition/plugins/service-keys';

export function defaultAgentDriverPlugin(id: string): RuntimePlugin<unknown> {
  return {
    id,
    scope: 'agent',
    provides: [capekAgentDriverKey],
    setup(context) {
      context.provide(capekAgentDriverKey, new DefaultAgentDriver());
    },
  };
}
