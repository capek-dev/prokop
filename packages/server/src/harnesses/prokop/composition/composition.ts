import {
  capekContextAssemblerKey,
  createAgentScope,
  createProcessScope,
  enterAgentScope,
  type AgentScopeHandle,
  type ContextAssemblyData,
  type ProcessScopeHandle,
} from '@capekai/core/composition';
import { jean2AgentPlugins, jean2ProcessPlugins } from './profile';

export interface Jean2RuntimeComposition {
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
export async function createJean2RuntimeComposition(): Promise<Jean2RuntimeComposition> {
  const processScope = await createProcessScope([...jean2ProcessPlugins()]);
  let agentScope: AgentScopeHandle | null = null;
  try {
    const createdAgentScope = await createAgentScope(processScope, [...jean2AgentPlugins()]);
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
