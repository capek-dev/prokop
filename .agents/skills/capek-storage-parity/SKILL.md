---
name: capek-storage-parity
description: Preserve deterministic behavior across Čapek memory, SQLite, and Jean2 conversation storage adapters.
---

## When to Use

Use when changing `packages/capek/src/storage/`, Jean2 conversation-storage adapters, message/part ordering, duplicate tool-call lookup, queue behavior, or indexed record fields.

## Procedure

1. Read `.architecture-specs/07-migration-phases.md`, `packages/capek/src/storage/contracts.ts`, both Čapek store implementations, and the Jean2 adapter or store method being changed.
2. Treat memory, standalone SQLite, and Jean2 persistence as behaviorally equivalent implementations of the same contract.
3. Define deterministic ordering explicitly. For equal timestamps, preserve insertion order using stable sequence or SQLite `rowid`, not lexical IDs.
4. When duplicate tool-call IDs exist, prefer a pending call before completed calls, then apply the documented newest/insertion-order rule.
5. When a record update changes an indexed field such as `createdAt`, update the normalized SQLite column and serialized record in the same operation.
6. Keep conversation history and queued orchestration inputs separate. Preserve queue FIFO and final persistence before downstream indexing or broadcast work.
7. Add the same regression scenario at each affected implementation or adapter boundary.

## Pitfalls

- Do not assume timestamps are unique or fast enough to establish order.
- Do not let SQLite query order differ from memory insertion order for equal timestamps.
- Do not update only serialized JSON when a duplicated indexed column also drives queries.
- Do not let a newer completed duplicate hide an older pending tool call.
- Do not fold pending asks, permission grants, or queued messages into conversation history merely to simplify storage composition.
- Do not claim a migration phase exit gate passed before its user-run smoke matrix is complete.

## Verification

- Run focused memory-store, SQLite-store, Jean2 adapter, and affected Jean2 message-store tests only.
- Cover equal timestamps, duplicate pending/completed tool calls, indexed timestamp updates, queue FIFO, and transaction rollback where relevant.
- Run affected package typechecks and lint.
- Compare the memory and SQLite result ordering for the same fixture.
- Confirm persistence completes before indexing or client-visible delivery at the changed boundary.
