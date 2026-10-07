import {
  capekContextAssemblerKey,
  type ContextAssemblyData,
} from '@/harnesses/prokop/composition/plugins/service-keys';
import {
  createAgentScope,
  createProcessScope,
  enterAgentScope,
  type AgentScopeHandle,
  type ProcessScopeHandle,
} from '@/harnesses/prokop/composition/plugins/compose';
import { prokopAgentPlugins, prokopProcessPlugins } from './profile';

export interface ProkopRuntimeComposition {
  processScope: ProcessScopeHandle;
  agentScope: AgentScopeHandle;
  /** Ordered context assembly through the composed agent scope. */
  buildContext(data: ContextAssemblyData): Promise<string>;
}

/**
 * Explicit Jean2 server composition root.
 *
 * The server owns the Jean2 plugin inventory and composes it through Capek's
 * generic process and agent scope factories after all adapters are installed.
 */
export async function createProkopRuntimeComposition(): Promise<ProkopRuntimeComposition> {
  const processScope = await createProcessScope([...prokopProcessPlugins()]);
  let agentScope: AgentScopeHandle | null = null;
  try {
    const createdAgentScope = await createAgentScope(processScope, [...prokopAgentPlugins()]);
    agentScope = createdAgentScope;
    const assembler = createdAgentScope.require(capekContextAssemblerKey);
    return {
      processScope,
      agentScope: createdAgentScope,
      buildContext: (data) => enterAgentScope(createdAgentScope, () => assembler.build(data)),
    };
  } catch (error: unknown) {
    try {
      if (agentScope !== null) {
        await agentScope.dispose();
      }
    } catch {
      // Preserve the composition failure as the startup error.
    } finally {
      try {
        await processScope.dispose();
      } catch {
        // Preserve the composition failure as the startup error.
      }
    }
    throw error;
  }
}
