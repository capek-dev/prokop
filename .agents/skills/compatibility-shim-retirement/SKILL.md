---
name: compatibility-shim-retirement
description: Retire Jean2 server forwarding directories safely after layered extraction, using ownership mapping and boundary gates.
---

## When to Use

Use when a Jean2 server migration has moved implementation ownership into `infrastructure`, `application`, `domains`, or `adapters`, but old `store`, `core`, `services`, route, or adapter forwarding paths still make the tree look bloated.

## Procedure

1. Read the applicable `.architecture-v2` target, phase exit gate, decision record, and current inventory before touching files.
2. Inventory the legacy directory with an import search. Classify each file as a pure forwarder, compatibility export, CLI presentation seam, or remaining behavior owner.
3. Delete only pure forwarders in one category. Redirect every source and test import to the named owner, preserving export identities where external callers still require them.
4. Move tests with the implementation owner when their path communicates obsolete ownership. Update aliases and fixtures without changing assertions or behavior.
5. Remove the category's temporary boundary exceptions and add or update AST/import gates so the old path cannot return. Leave explicit D2-015 composition exceptions intact.
6. For module-load registration bypasses, add an explicit bootstrap import or registration call before rerouting lookup and status paths. Remove each temporary boundary exception immediately after the owning seam is adopted.
7. Inspect the diff for unrelated changes, then run only the category's focused typecheck, boundary gate, and focused tests. Do not claim the full migration is verified from focused checks.

## Pitfalls

- Do not delete a directory merely because its name is old. Retained paths may be deliberate compatibility, CLI, or concrete composition seams.
- Do not redesign behavior during file retirement. S9 treats this work as ownership movement and enforcement.
- Do not move several unrelated categories together. A failed test or import can otherwise hide the responsible slice.
- Do not remove explicit adapter bindings recorded by D2-015 without a separate architecture decision.

## Verification

Confirm the retired path has no remaining imports, the layer-boundary suite passes for the category, focused source and test typechecks pass, and the architecture inventory still explains every retained legacy-looking path.
