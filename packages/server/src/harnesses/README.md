# Session harness implementations

`prokop/` adapts the Čapek execution loop to the host's `SessionExecutionPort`. Čapek runtime composition, scoped storage, permissions and shared host adapters remain in `src/adapters/capek/`.

`codex-cli/` owns the Codex app-server protocol, per-session thread binding, lost-turn recovery and model catalog. It does not use Čapek's provider credentials. The Codex OAuth *model provider* is separate and remains in `src/infrastructure/providers/`.

`src/bootstrap/application.ts` registers each harness by persisted `Session.harness`. `src/application/sessions/harness-execution.ts` routes execution by that identity and denies unknown owners. Host transport, session repository, controller checks and SQLite schema remain outside these implementations.

To add a harness, first define its verified process protocol, capabilities, approval denial/reply behavior, durable binding and restart reconciliation. Then extend persisted identity, SDK and intake validation together, register it here and test all entry points. A new directory alone does not make a harness available. Preconfig and memory reuse require separate policy decisions.
