---
name: capek-runtime-event-boundaries
description: Preserve Čapek generic runtime events and Jean2 transport mapping during event or delivery refactors.
---

## When to Use

Use when changing Čapek runtime events, host delivery, notifications, session routing, retry events, ask delivery, or the Jean2 WebSocket adapter that maps package events to wire messages.

## Procedure

1. Read `packages/capek/src/runtime/events.ts`, the runtime host/delivery seam, and the Jean2 transport adapter before editing.
2. Keep Čapek events transport-independent. Use package-owned event kinds and audiences, not Jean2 WebSocket message names or connection objects.
3. Preserve audience semantics: global, session, origin, controller, ask targets, and host. Keep origin-to-session attachment explicit.
4. Keep Jean2 responsible for mapping generic events to `ServerMessage` shapes, WebSocket routing, controller and ask-target resolution, title policy, and web-push behavior.
5. Preserve ordering at the adapter boundary: persisted user messages and parts before delivery, terminal messages before notification, usage delivery before usage persistence, queue sending before queue deletion, and title persistence before rename delivery.
6. Treat event delivery failure separately from provider failure. Do not turn sink or transport errors into model retry decisions.

## Pitfalls

- Do not import SDK wire contracts into Čapek runtime event contracts.
- Do not move routing policy into the package merely to simplify an adapter.
- Do not replace event-driven completion with polling or manual refresh.
- Do not change interruption or terminal status semantics while relocating event delivery.

## Verification

Inspect the package event contract and Jean2 adapter diff together. Confirm all audiences and event kinds still map to the intended wire routes, ordering-sensitive persistence boundaries remain intact, and focused package/server compatibility checks cover malformed asks, retries, terminal delivery, and routing. Do not claim full migration verification from focused checks alone.
