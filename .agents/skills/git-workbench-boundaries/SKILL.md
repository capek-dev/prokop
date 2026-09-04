---
name: git-workbench-boundaries
description: Jean2 Git workbench and session-worktree ownership, safety, root resolution, parsing, and event-driven updates.
---

## When to Use

Use this skill when changing Git workbench behavior, managed worktrees, session-root selection, Files/Changes panels, or repository-operation safety.

## Procedure

1. Keep worktree lifecycle and user-facing session attachment in Prokop server/client code. Čapek receives only validated opaque `workspaceRootId` values and must not infer roots from arbitrary paths.
2. Trace session root resolution through the authoritative managed-worktree registry and file-policy allowlist. Available managed roots may be authorized; unavailable roots must fail closed, never silently fall back to the primary checkout.
3. Preserve session identity when workspace paths change. Update the existing workspace record and path, while leaving `workspace_id` and attached sessions unchanged.
4. Resolve Files and Changes from the focused session's root. Display the selected branch/readable label, not the internal worktree UUID or directory basename. Keep exact-path matching only as a legacy fallback when persisted `managedWorktreeId` is absent.
5. Refresh worktree attachment metadata from authoritative session lifecycle/runtime events. Serialize repository operations, revalidate identity and availability at operation time, and block removal for dirty, running-session, or terminal-attached worktrees.
6. For new sessions, make the root choice explicit: primary checkout, existing managed worktree, or a newly created isolated worktree. Include recovery actions when a previously attached worktree is unavailable.

## Pitfalls

- Do not add silent primary-checkout fallback for missing or removed managed roots.
- Do not expose internal UUIDs as path-selector labels.
- Do not authorize unavailable managed roots or retain stale roots in the file policy.
- Do not remove worktrees with force removal or while active resources still depend on them.
- Do not treat client incidental state as authoritative for attachment metadata.

## Verification

- Test root resolution for primary, available managed, unavailable managed, and legacy exact-path cases.
- Test that workspace path updates preserve `workspace_id`, sessions, and messages.
- Test session switching updates both Files and Changes roots and labels.
- Test unavailable-root recovery and removal guards.
- Perform browser smoke checks for creation, session switching, pinned roots, and recovery before calling the feature release-ready.
