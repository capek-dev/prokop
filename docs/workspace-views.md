# Workspace views and docks

The client separates view identity from placement. The center, left, right, and
bottom each contain a tab group. Sessions, Explorer, Changes, Branches, Worktrees,
and Terminals are movable tool views. Each open session and file is an independent
resource tab that can share a group with those tools or occupy another dock.
There is no Conversations wrapper, dedicated grid mode, or six-session limit.
Terminals still owns its terminal tabs; separating that collection is future work.

Each region can contain multiple independent tab groups. Left and right use
vertical splits, bottom uses horizontal splits, and center supports nested splits
in either direction. Split right/down moves the active tab into a new group; it
requires at least two visible tabs and never duplicates a view. Empty groups
collapse into their sibling. Each region retains one group when empty.

## Entry points

- `packages/client/src/stores/workspaceViewStore.ts` owns membership, selection,
  hidden views, validated versioned persistence, and mobile terminal visibility.
- `packages/client/src/stores/dockStore.ts` owns peripheral visibility and size.
- `packages/client/src/stores/workspaceSplitLayout.ts` owns the split-tree types
  and traversal. `WorkspaceSplitTree.tsx` renders groups and resize dividers.
- `packages/client/src/components/app/WorkspaceContentArea.tsx` supplies resource
  content and the dirty-document unload guard.
- `packages/client/src/components/app/WorkspaceViews.tsx` renders responsive regions
  and routes each view to its current slot. `WorkspaceViewGroup.tsx` supplies tabs,
  movement, hiding, restoration, and reset controls.
- `packages/client/src/components/app/WorkspaceViewHost.tsx` owns the stable portal
  destination and exposes visibility to resource controllers.

## Opening or moving a view

Desktop actions call `useWorkspaceViewStore.getState().activateView(id)`. This
unhides the view, selects its tab, and opens its current dock. Callers must not
assume Explorer belongs on the right or Terminals at the bottom. Mobile file/session
actions continue to select `chatLayoutStore.mobileSurface`; the mobile terminal
has independent transient visibility.

`moveView(id, region)` transfers the existing ID, selects it at the destination,
and closes a peripheral source if it has no remaining unhidden views. `hideView`
only removes a view from navigation. It does not close files, discard drafts, or
terminate processes. Each desktop group has one panel options menu for adding or restoring views
and resetting the arrangement.
The menu remains available in empty groups. Its view list omits views already in its group, lists
hidden views under Open here, and lists other views under Move here with their
current dock. Every action reuses the existing identity. Reset restores the default arrangement.
Right-clicking a desktop tab opens actions for that tab without selecting it.
The tab context menu owns move, split, close, and hide actions; move destinations
live under a Move to submenu. The panel menu only manages its contents and
arrangement, independently of the selected tab.

Desktop shortcuts target dock positions: Mod+1 focuses the left dock, Mod+2 the
right dock, and Mod+T the bottom dock. They open the dock and focus its selected
tab without activating a particular tool or changing split selections. Shift+Escape
collapses the focused peripheral dock without hiding its tabs; it does nothing in
the center. Phone shortcuts retain their Sessions, Files, and Terminal navigation.
Stored bindings for the old navigation/panel commands migrate to dock commands,
including explicit unassignments. Alt+1 through Alt+9 select any visible tab in
the focused group, in displayed order. Alt+Shift+Left/Right cycle that same group.
Hidden and unavailable tabs do not consume a number; out-of-range numbers do
nothing. Focus inside a view selects its owning group, including split groups.
Without a focused group, shortcuts use the first center group (or the mobile
strip). Stored session-pane bindings migrate to the corresponding tab commands.

Desktop tab strips support native dragging through `useWorkspaceTabDrag.ts`.
Dragging previews an insertion marker and scrolls near the strip edges; only a
drop calls `moveView(id, region, beforeId)`. A null anchor appends, and an omitted
anchor preserves existing menu behavior. Anchoring by ID keeps hidden or unavailable
views from shifting the intended position. Drags accept only a source from this
document and visible destinations. Collapsed docks do not open on hover. Mobile
strips retain touch scrolling. Layout persistence and stable view hosts are shared
with menu-driven moves.

The layout has four region roots, each a group leaf or a split with direction,
ratio, and two children. Groups are keyed independently of regions. Use
`findViewGroup` for tab selection and `findViewRegion` for dock visibility.
Movement accepts a group ID; a region destination selects its first group.
Splits retain content through the same stable hosts, even when the group tree
changes. Hidden/internal placement anchors transfer to the surviving group when
an empty leaf is removed. Unavailable groups are filtered from rendering without
discarding saved placements. Mobile does not render splits or change their ratios.

Repository views have independent fixed content; there is no nested Files switcher
on desktop. Explorer, Changes, and Branches share the focused session's root and
pin, including unavailable-root guards. Worktrees stays workspace-scoped and is
available even when empty. Mobile selects these same hosts through one repository
tab strip, without changing their desktop placements.

Placement is device-local across workspaces. Repository browsing follows the
selected workspace and focused session; open files retain their own workspace
and checkout across project switches. Moving a view does not change
its filesystem root or session identity. Missing resources, such as an editor
without open documents, are filtered from navigation without rewriting placement.

## File resources

File view IDs encode the existing document identity (server, workspace, root, and
normalized path). `fileEditorStore.openDoc` and `setActiveDoc` activate that resource
at its current placement. `closeDoc` removes its layout reference. These changes
happen in actions, not effects that synchronize stores.

`WorkspaceContentArea` supplies server-scoped file descriptors: name, path, dirty status,
activation, and a close callback to the existing editor dirty guard. Each
`FileEditorSurface` receives a `documentId` and renders one document. Its selection
is independent of the last globally focused document, so files can remain visible
in multiple docks. Mobile uses the same resource hosts with one file strip.
Project selection does not hide or unmount open files, and focusing an editor does
not change the selected project. The editor path display and tab description show
the file's project, checkout, and relative path. Duplicate file names include that
context in their tab labels. Reads, saves, and diffs use the document's identity.

Unvisited documents load only when visible. Once loaded, their editor remains
mounted across tab switches and moves. Hidden editors disable their Git diff
observer. Close commands are disabled while saving. A save response records the
submitted content as the baseline, so any newer edits stay dirty.

Layout persistence is version 5 and accepts version 1 through 4 arrangements. The old
Files view expands into the four repository views in its saved dock, preserving
its hidden state. The legacy Editor placement becomes the default for new file tabs. Saved resource placement
does not restore document contents. Reset preserves resource IDs and returns them
to the default center group; it never discards open documents. Mobile tab search finds tabs
by name or path and restores hidden tabs in their existing locations.
Pre-split arrangements migrate to one leaf per region. V5 validation rejects
duplicate or unattached groups, duplicate tabs, invalid ratios, excessive nesting,
and directions not supported by a region.

## Session resources

`useWorkspaceSessionTabs.tsx` composes server-scoped session IDs, titles, running
and input-needed indicators, routed focus, and close actions. `WorkspaceSessionView`
mounts its `SessionPane` on first visibility, retaining the pane through movement,
tab switches, hidden docks, and mobile changes. `WorkspaceHeader` receives an
explicit session ID so concurrently visible sessions keep their own controls.

`sessionBoardStore` retains its existing name for callers, but owns only open
session IDs and global session focus. Its opening entry points append or focus
tabs. The view store owns each dock's independent selection. Close removes only
navigation and layout references, without archiving, interrupting, or deleting the
session. Close others/all applies only to session tabs. Existing draft persistence,
streaming, permissions, and subscriptions remain session-scoped.

Old route `open` parameters restore session tabs, including sessions outside the
first list page. Existing Conversations/Editor layout IDs are internal placement
anchors for new resources and are absent from the UI. Fork replacement keeps
placement and the other open session IDs in the URL. Server teardown clears active
session navigation while retaining saved placements. Late route discovery responses
from an old client are ignored.

Unvisited sessions defer heavy rendering; visited panes remain mounted. This is
not a bounded cache of visited panes and does not claim measured browser performance.

## State and lifetime

Each view renders through a constant React portal destination. A layout effect
reparents that host DOM element when placement changes; React does not recreate
the view. Hidden hosts remain mounted and inert. Reparenting preserves nonzero
scroll offsets and focused descendants. The same hosts span mobile and desktop.

Portal events follow React ancestry, not their new DOM parent. Compact right docks
therefore use a nonmodal overlay, not a modal dismissal/focus boundary that would
interpret view events as external. Resource-owned dialogs remain inside their
own React trees.

The terminal controller starts on first reveal, then retains its client connection
and cached output while hidden. Changing workspace/client or unmounting disposes
those resources. Explicit terminal-tab close still destroys the server terminal.
`TerminalView` suspends fitting and focusing while hidden and cancels pending
animation frames and resize timers during cleanup.

## Verification

`WorkspaceViews.test.tsx` checks identity, local draft state, scroll, focus, menu
actions, collapse, breakpoints, and independent mobile terminal visibility.
`TerminalPanel.lifecycle.test.tsx` uses fake SDK connections with the real terminal
connection hook to check background output, reconnect counts, scope cleanup, and
explicit destruction. Store tests cover placement invariants and invalid storage.
Keyboard tests verify that commands follow moved views.
`WorkspaceFileTabs.test.tsx` exercises independent file selection, dirty closing,
save failures/conflicts, path-scoped writes, mobile transitions, and selection among
many tabs. It uses fake SDK calls and a stateful editor mock; actual Pierre undo
behavior and browser geometry still need a manual smoke test. Browser geometry and real
editor/terminal smoke testing are separate from these component checks.
