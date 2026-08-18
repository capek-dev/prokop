import {
  capekContextAssemblerKey,
  createCurrentAgentScope,
  createCurrentProcessScope,
  enterAgentScope,
  type AgentScopeHandle,
  type ContextAssemblyData,
  type ProcessScopeHandle,
} from '@capekai/core/internal/composition';

export interface Jean2RuntimeComposition {
  processScope: ProcessScopeHandle;
  agentScope: AgentScopeHandle;
  /** Ordered context assembly through the composed agent scope. */
  buildContext(data: ContextAssemblyData): Promise<string>;
}

/**
 * Kernel composition representation of the Jean2 runtime.
 *
 * Must be called after the `configureX()` installation performed by
 * `createRuntime()`: the composed providers are bound to the exact installed
 * adapter objects, so `require()` on the scope resolves the S1 exports by
 * identity. Server startup creates the shared execution composition after
 * this installation, and the session and scheduled execution adapters enter
 * that composed agent scope for the full awaited duration of each entry.
 *
 * C3 exposes ordered context assembly through the same representation:
 * `buildContext` enters the composed agent scope (seeding the exact installed
 * accessors synchronously) and delegates to the required context assembler
 * service. This factory remains the composition and diagnostics surface; live
 * execution adoption is centralized in the execution adapters.
 */
export async function createJean2RuntimeComposition(): Promise<Jean2RuntimeComposition> {
  const processScope = await createCurrentProcessScope();
  let agentScope: AgentScopeHandle | null = null;
  try {
    const createdAgentScope = await createCurrentAgentScope(processScope);
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
