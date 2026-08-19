/**
 * Internal kernel barrel. Tests import from here; the package root index
 * intentionally does not re-export the kernel.
 */

export { createAgentScope, createProcessScope, createRunScope } from './kernel';
export { serviceKey } from './service-key';
export { dispatchEvent, validateListener } from './events';
export {
  ActivationError,
  CompositionError,
  DependencyCycleError,
  DisposalError,
  DuplicateContributionError,
  DuplicatePluginError,
  DuplicateProviderError,
  EventEmitError,
  InvalidOverrideError,
  KernelError,
  LifecycleError,
  MalformedPluginError,
  MissingDependencyError,
  RunTerminalError,
  ScopeValidationError,
  ServiceCollisionError,
  errorMessage,
} from './errors';
export type {
  DisposalFailure,
  ListenerFailure,
} from './errors';
export type {
  AgentScopeHandle,
  CapekPlugin,
  CleanupBarrier,
  CompositionDiagnostics,
  ContextBuildContext,
  ContextPhase,
  ContextSectionContribution,
  ContextSectionDiagnostic,
  Disposable,
  EffectiveContextSection,
  EffectiveTool,
  EventListenerContribution,
  KernelEvent,
  KernelEventMap,
  KernelEventType,
  ListenerDiagnostic,
  PluginContext,
  PluginDiagnostic,
  PluginOptionsMap,
  ProcessScopeHandle,
  ProvidedContextSection,
  RunCancellation,
  RunDisposedEvent,
  RunScopeHandle,
  RunStartedEvent,
  RunStatus,
  RunTerminalEvent,
  RunTerminalOutcome,
  RuntimeScope,
  ScopeDiagnosticsSnapshot,
  ScopeHandle,
  ScopeStatus,
  ServiceDiagnostic,
  ServiceKey,
  ServiceOverride,
  ToolContribution,
  ToolDefinition,
  ToolDiagnostic,
  ToolVisibility,
} from './types';
