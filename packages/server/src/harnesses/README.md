# Session harness implementations

`prokop/` owns the built-in agent engine and implements the host execution port. The turn loop lives in `prokop/execution/`; compaction, retry, goals, workflows, and subagents have their own folders. Assembly lives in `prokop/composition/`, host bindings and storage adapters in `prokop/host/`, learning in `prokop/learning/`, and built-in tools in `prokop/tools/`. Bootstrap installs the application ports that expose these capabilities.

`shared/domain-tools.ts` exposes memory, skills, and session search to all three harnesses. Workspace policy stays in `src/adapters/workspace-paths.ts`, provider registry wiring in `src/adapters/providers/runtime-registry.ts`, and MCP model output conversion in `src/infrastructure/mcp/model-output.ts`. Memory, skills, and session-search implementations also live under `shared/`. Provider registration/model construction, external-tool loading, storage helpers, and sandbox simulation live in server infrastructure. Consumers import implementation owners directly; there is no runtime package or package-export forwarding layer.

`codex-cli/` owns the Codex app-server protocol, per-session thread binding, lost-turn recovery and model catalog. It does not use Čapek's provider credentials. The Codex OAuth *model provider* is separate and remains in `src/infrastructure/providers/`.

`src/bootstrap/application.ts` registers each harness by persisted `Session.harness`. `src/application/sessions/harness-execution.ts` routes execution by that identity and denies unknown owners. Host transport, session repository, controller checks and SQLite schema remain outside these implementations.

To add a harness, first define its verified process protocol, capabilities, approval denial/reply behavior, durable binding and restart reconciliation. Then extend persisted identity, SDK and intake validation together, register it here and test all entry points. A new directory alone does not make a harness available. Preconfig and memory reuse require separate policy decisions.
