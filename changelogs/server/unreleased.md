### Changed

- Register Prokop and Codex CLI as separate server harnesses. Session execution dispatches by persisted harness ownership, while shared session creation rules apply to HTTP and WebSocket requests.
- Reject unknown harness owners and unsupported operations without falling back to Prokop. Scheduled and learning sessions remain explicitly Prokop-owned.
- Keep the Codex CLI process, thread binding, recovery, and model catalog under its harness directory. Codex OAuth model-provider integration remains separate.
- Choose Prokop or Codex CLI models from one picker in an empty root session. The first message locks its harness; model and effort changes within the established harness remain available.
- Supply enabled workspace USER.md and MEMORY.md to Codex CLI as bounded developer instructions on thread start and resume, using the session's selected workspace root. No Codex config files or preconfigs are changed.
