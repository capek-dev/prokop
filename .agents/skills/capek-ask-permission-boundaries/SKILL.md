---
name: capek-ask-permission-boundaries
description: Maintain Jean2 and Čapek ask, permission, grant, replay, authority, and malformed-response compatibility after Phase 4 extraction.
---

## When to Use

Use when changing ask, permission, grant, replay, authority, cleanup, scheduler gating, or response routing across `packages/capek` and Jean2 server adapters.

## Procedure

1. Read `.architecture-specs/00-principles.md`, Phase 4 in `.architecture-specs/07-migration-phases.md`, `packages/capek/src/tools/ask-user-api.ts`, `packages/capek/src/tools/permission-request-manager.ts`, and the current Jean2 interaction adapter.
2. Keep lifecycle and policy in Čapek: request identity, waiters, timeout and cleanup, response validation, auto-approval bounds, grant policy, and reconnect routing.
3. Keep Jean2 infrastructure behind interaction bindings: pending-request and grant persistence, WebSocket delivery, session/workspace state, notifications, and authority selection.
4. Route responses by request identity first. A live generic ask with `requestId` resolves before permission fallback. Legacy `toolCallId` aliases retain insertion-order behavior. Wire-side Jean2 handlers must call the adapter seam (`adapters/capek/contracts.ts`), whose `withJean2ComposedScopeSync` re-enters the composed scope; direct `@capekai/core/ask-authority` calls can resolve a process-default runtime with no live waiter.
5. Remove generic pending asks by request ID, not by tool call ID, because generic and permission asks may share one tool call.
6. Treat malformed, missing, unknown, and unsupported permission outcomes as denial. Preserve the raw payload in audit persistence without creating a grant.
7. Preserve scheduler permission gating and existing grant reuse when changing tool exposure or authority routing.

## Pitfalls

- Bun `mock.module()` is process-wide; mocking the Capek ask-resolution modules from one test file can hang the whole server suite at exit when other suites run the real machinery. Test the ask-response handler through its injected seam (`handleAskResponseWithDependencies` / `AskResponseDependencies` in `transport/websocket/handlers/misc.ts`) with local fakes instead (see `tests/transport/ask-response-authority.test.ts`). Also avoid importing the aggregate `message-router` in tests that only exercise one handler; it eagerly imports every handler's runtime dependencies.
- Do not move SQLite, WebSocket, notification, or client authority infrastructure into Čapek merely because package code invokes a host callback.
- Do not route generic ask responses through permission grant creation.
- Do not delete every pending record for a tool call when resolving one generic ask.
- Do not treat controller authority as durable after restart.
- Do not approve malformed responses or discard their audit payload.
- Do not redesign permission policy during a relocation or compatibility fix.

## Verification

- Run focused package and server ask/permission tests, including mixed generic and permission asks, reconnect routing, no-waiter audit records, bounded auto-approval, grant reuse, authority modes, and scheduler gating.
- Run affected package typechecks and lint.
- Confirm `packages/capek` has no `@jean2/server` import.
- Confirm Jean2 adapters still own persistence, delivery, notifications, and authority infrastructure.
- Update the active architecture ledger and leave user-operated smoke gates open until the user completes them.
