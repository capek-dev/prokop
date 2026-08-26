---
name: chat-retry-resilience
description: Jean2 provider retry lifecycle, sandbox simulation, and package-first Čapek relocation boundaries.
---

## When to Use

Use when changing or relocating Jean2 provider retries, retry status events, failed-attempt transcript handling, circuit breaking, sandbox retry simulation, or the model-run boundary into `packages/capek`.

## Procedure

1. Read `.architecture-specs/00-principles.md`, the active phase in `.architecture-specs/07-migration-phases.md`, and the current retry implementation before editing.
2. During relocation, move the working retry path without changing policy. Keep one production implementation and use server compatibility re-exports where needed.
3. Preserve one outer operation with a shared abort signal, `runningAt`, backoff, and cleanup. Keep exponential jitter, provider `Retry-After` as a minimum, and the existing retry count unless a separate behavior phase changes them.
4. Classify errors before retrying. Quota or billing exhaustion is non-retryable. Retryable failed attempts use `mode: 'retry_failed'` and stay out of future model context.
5. Stop automatic retry after any tool activity, including tool-part creation or update, to avoid replaying side effects.
6. Keep retry state session-scoped in the client. Drive UI from `chat.retry` statuses (`scheduled`, `started`, `exhausted`, `cancelled`), not connection retry counters or polling.
7. Simulate recovery through the sandbox with one failed stream response followed by success. Keep event delivery failures separate from provider failure classification.
8. Update `.architecture-specs/01-current-runtime.md` and the active phase ledger before claiming relocation complete.

## Pitfalls

- Do not use the old `capek` branch's parallel `runAgentTurn` migration as the `capekv2` baseline.
- Do not combine file relocation with retry-policy redesign or wire-event changes.
- Do not retry after tool activity.
- Do not treat backoff as an operation timeout. It must remain cancellable through the session interrupt path.
- Do not show intermediate failed attempts as final completion or notification events.
- Do not let event-sink failures become provider failures, and do not hide synchronous ask-delivery failures behind an unobserved async callback.

## Verification

- Run focused retry, stream, tool-activity, cancellation, sandbox, and package/server compatibility tests for the changed batch.
- Confirm the `chat.retry` sequence and final success or exhaustion event remain compatible.
- Confirm failed assistant attempts use `retry_failed` and are excluded from the next model request.
- Confirm abort interrupts active streaming and backoff delay.
- Run affected package typechecks and lint. Do not run the full repository suite by default.
- Confirm any required server smoke check is user-run before completing the phase.
