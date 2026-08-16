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
 * identity. The runtime execution path is unchanged; transport and use cases
 * adopt this composition in S2.
 *
 * C3 exposes ordered context assembly through the same representation:
 * `buildContext` enters the composed agent scope (seeding the exact installed
 * accessors synchronously) and delegates to the required context assembler
 * service. This is a representation, not a claim of live scope adoption: the
 * production execution path still runs through the existing `configureX()`
 * installation.
 */
export async function createJean2RuntimeComposition(): Promise<Jean2RuntimeComposition> {
  const processScope = await createCurrentProcessScope();
  const agentScope = await createCurrentAgentScope(processScope);
  const assembler = agentScope.require(capekContextAssemblerKey);
  return {
    processScope,
    agentScope,
    buildContext: (data) => enterAgentScope(agentScope, () => assembler.build(data)),
  };
}
