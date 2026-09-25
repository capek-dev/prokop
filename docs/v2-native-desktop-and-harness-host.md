# v2: native desktop, local host, and interchangeable harnesses

Status: Slice A accepted as a native client proof of concept; next priority is using the Prokop harness alongside Codex CLI. This document does not authorize a runtime rewrite, a server start, or removal of the web client.

Slice A checkpoint: `apps/desktop/` is a native GPUI preview that lists workspaces and sessions over HTTP and opens a selected session with an HTTP transcript fallback and authenticated WebSocket worker. The UI has a composer, live text events, and interrupt controls gated on session control. Manual retesting confirmed that session navigation and transcript scrolling no longer lag after switching the sidebar to GPUI Kit's virtualized searchable `List` and optimizing GPUI's debug dependencies. The transcript still displays 10 of its latest 50 messages per page; replacing this with `MessageScroller` is separate work. The selected-session worker now retries transient WebSocket failures with backoff and reloads the authoritative latest 50 messages on each resume before accepting live deltas; it does not retry invalid credentials or a deleted session. Manual use also confirmed sending to an existing chat, streaming a response, and Interrupt. Attach-only now checks the public `/api/info` API shape and verifies credentials when required before loading workspaces/sessions. Failure keeps each host's prior list and shows an actionable per-host error, without starting or stopping processes. This does not establish durable host identity or prove that a responding process owns a particular installation. Sixteen focused Rust tests cover HTTP envelopes, attach classification, host-scoped identity, search across 240 records, transcript paging, offline retention, wire-event parsing/routing, retry wait and cancellation; `cargo check --offline --locked` and `cargo test --offline --locked` pass. Manual testing against a running host confirmed attach, disconnect, and reconnect; workspace/session list recovery still requires manual refresh. This is enough evidence to pause Slice A as a proof of concept, not to claim its production exit gate is met. Managed local launch if attach-only is insufficient, secure remote setup, durable host identity, independently owned two-host integration, and desktop approvals are deferred while work shifts to harness support.

## End goal

Open Prokop as a fast native desktop workspace, not as a server administration screen. On first launch, it starts or attaches to a local Prokop host automatically. The same headless host can be installed on another machine; one desktop client can show projects and sessions from several hosts at once. The Prokop harness runs out of the box and remains usable independently of the desktop client. A session can instead run through a supported external harness such as Codex, Claude Code, or OpenCode, without switching to that harness's CLI interface.

The host owns the workspace, filesystem, Git, terminal processes, credentials, transcripts, learning, memory, and search. The desktop owns presentation, client preferences, and connections. A remote path or secret is never interpreted on the desktop machine. The Prokop layer offers selected context and tools to external harnesses where their integration actually permits it; it does not claim to replace their internal context or security policies. A handoff between harnesses is explicit, with provenance and a summary, not a silent reassignment of a live conversation.

Success means: local use needs no manual server setup; remote hosts look like more places to work rather than separate applications; a disconnected host does not erase other hosts' state; supported harness activity appears in the same session UI with honest capability differences; and the packaged application's startup, memory, size, and crash recovery are measured against the current web-plus-host baseline rather than assumed to be better because it is Rust.

## Product boundaries

| Part | Owns | Does not own |
| --- | --- | --- |
| Native GPUI desktop | Windows, navigation, transcript rendering, interactions, connection registry, per-host caches | Workspace files, provider credentials, agent execution, shared SQLite writer |
| Prokop host, local or remote | Authenticated API/events, workspaces, persistence, memory and learning, search, MCP/tool policy, harness lifecycle | Desktop rendering, global client-only state |
| Prokop harness (Čapek) | Its own execution, context assembly, model/tool loop, permissions and cancellation | External harness internals |
| External harness adapter | Launch/connect/resume its own harness, normalize events and capabilities, forward supported context/tools | Pretending the external harness is a Čapek model provider |

`(host identity, workspace identity, session identity)` is the client-side key. Host identity must be stable across address changes and a reinstall must not silently assume ownership of an old host's data. A connection URL is an address, not identity; define the stable host ID and migration behavior before persisting a multi-host index. Sessions and learning remain authoritative on the originating host. Any cross-host search or memory synchronization is a later, explicit feature with opt-in and provenance; presenting several hosts in one sidebar is not replication.

A harness is chosen for a session, while models/accounts are choices inside a harness. The UI shows only operations the adapter supports: approvals, questions, streaming, resume, interrupt, model choice, and so on. Unsupported operations must be disabled or absent. For Codex, distinguish the Codex CLI harness from the current Prokop Codex OAuth model integration, which is not an external harness adapter.

## Current starting point and compatibility

- `packages/server/src/index.ts`, `transport/http/app.ts`, and `transport/websocket/bun-adapter.ts` already run the Bun/Hono host and serve HTTP/WebSocket; `infrastructure/runtime/client-assets.ts` embeds the existing web UI. Keep the web client operational during exploration.
- `packages/server/src/infrastructure/daemon/index.ts` already manages a detached host process. The native launcher must first distinguish an owned local child from an existing user-managed daemon, then define readiness, restart, upgrade, logs, data-root isolation, and shutdown. Never kill an unrelated process because it occupies a port.
- `packages/client/src/config/servers.ts` saves server URLs; `components/shell/ServerShell.tsx` and `hooks/useConnectionLifecycle.ts` currently operate on one selected connection. Saved connections are not a simultaneous merged workspace view.
- `packages/server/src/adapters/capek/profile.ts` composes the Prokop harness from external `@capekai/core`; Prokop server owns its application services and session-search host adapter. Do not turn the external CLI harnesses into AI SDK model aliases or move Prokop-specific domains into Čapek.
- `.architecture-v2/00-principles.md` and `09-decisions.md` describe the current migration's single Čapek execution path, ordered events, storage compatibility, and fail-closed permissions. External harness adapters are separate engines chosen explicitly per session, not a second implementation of the Čapek runtime. Any changed compatibility rule needs a separate decision and tests.

## Proof of concept, two bounded slices

### Slice A: prove the native client and host boundary

1. Add an experimental Rust desktop application outside the Bun `packages/*` workspace (proposed `apps/desktop/`). Use GPUI for actual native controls, not a WebView of the React client. Pin compatible GPUI/GPUI Kit revisions at implementation time after a minimal build check; GPUI is pre-1.0.
2. Implement a small Rust client for the existing authenticated host API and event stream, using the current wire contracts as fixtures. Do not invent a parallel persistence schema or translate the full TypeScript SDK at once. Start with host info, workspaces, sessions, one transcript, one message, and interruption. Use local fake host fixtures for repeatable UI/transport tests.
3. Make the desktop attach to a known local host or launch a managed host subprocess from a known packaged binary. Use loopback binding, explicit per-install data root, authenticated requests, bounded readiness, child ownership, and actionable failure UI. Never silently start a remote host; remote URLs require an explicit add action. Decide whether closing the window stops an owned host only after testing ongoing sessions and background work.
4. Connect to a second, separately owned test host. Show both hosts' projects/sessions in one native sidebar; select a session from either without corrupting the other host's cache. If one connection drops, show its offline state without clearing the healthy host. Reconnect through server events and reload the authoritative snapshot on gaps.

**Slice A exit gate:** a native window can discover/launch or attach locally, show a real saved Prokop session, send one Prokop-harness turn through the host, interrupt it, reconnect and reload its transcript, then browse an independent second host. During automated verification use fixtures and an isolated test data root. A manual run with real host processes requires separate permission. If only a window and server list work, this slice has not proved the product.

### Slice B: prove the layer above a second harness

Next priority: keep the working Prokop harness available and make Codex CLI usable in a separate session in the same workspace. The intended two layers are the Prokop server, which owns sessions, transport, storage, and harness routing, and the Prokop agent harness, whose loop runs in Čapek. Today the server's execution port is implemented only by the Čapek adapter; harness-independent routing is a goal of this slice, not a shipped capability. Verify Codex CLI's integration protocol before defining its server-owned adapter. Do not treat the existing Codex OAuth model provider as a Codex CLI harness. Expose only supported operations to the desktop. Claude Code and other CLI harnesses are out of scope for this slice.

1. Define a small server-owned harness interface from Codex CLI's actual integration protocol: start/resume, send, cancel, event mapping, approval/question replies, status, and declared capabilities. Verify its supported protocol, authentication, redistribution rules, and session ownership. Do not scrape terminal output to fabricate structured messages.
2. Persist a Prokop session reference to its external harness session with host, adapter kind, version, workspace root, and provenance. Keep its transcript and search indexing on the owning host without writing into the external harness's store. On restart, reconcile running versus completed work before accepting a new turn.
3. Expose a narrow, scoped Prokop memory/search/tool surface through the integration the chosen harness supports (MCP where appropriate). Test which context was actually used; do not assert that internal Prokop context selection, learning injection, or permission policy applies inside the other harness. Do not hand out broad filesystem access through a convenience bridge.

**Slice B exit gate:** in one workspace, a Prokop-harness session and one external-harness session appear together, stream useful activity, survive client reconnect, and show correct approval/interrupt behavior. A deliberately selected memory or search item is available through a supported bridge and its use is observable. Unsupported features are labelled as such. No live provider call is required for automated tests.

## Native UI evaluation

Start with GPUI Kit's styled components or its unstyled base only where the surface needs custom presentation. Its documented `MessageScroller` supports variable-height virtualization, tail following, prepend anchoring, and streaming row remeasurement, useful for transcripts; the `Editor`, dock, and tree are candidates for later file/workbench work, not proof they match Prokop's existing behavior. Keep the first UI small: host/project navigation, session list, transcript, composer, approvals, and offline states. Test keyboard focus, text selection, long transcripts, resize, accessibility, and appearance on the target OS before committing to a component. Do not adopt `gpui-shell` merely to reuse React: it renders GPUI views from JavaScript, not DOM components.

GPUI's README says it is still pre-1.0 with breaking changes. GPUI Kit documentation currently lists Rust 1.90+, macOS 15+, Windows 10+, and Linux dependencies. These are planning constraints, not verified support on our release targets. Measure cold start, idle/active memory, a long transcript while streaming, application plus bundled host size, and recovery after killing one host. Compare equivalent workflows, not a blank GPUI window to a loaded web session.

## Path to a fuller Rust rewrite, if evidence supports it

1. Keep the host protocol and storage ownership explicit so a Rust implementation can replace host internals without replacing the desktop client or forcing a new session format.
2. Move one host responsibility at a time behind tested transport/storage contracts. Do not let both Rust and Bun processes write the same Prokop database; use one owner with migration/backups and rollback before cutover.
3. Keep Čapek usable independently. Rewriting its execution behavior in Rust is a separate decision that must preserve tool policy, retries, cancellation, ordered delivery, and conversation compatibility; a GPUI client does not require it.
4. Retain the existing web/PWA client until native parity for agreed desktop workflows is demonstrated. Browser/mobile reach and remote host access need their own product decision, not an incidental deletion.

## Explicitly deferred decisions

- Managed local host lifetime: window-bound child, shared background service, or attach-first hybrid. Test background sessions and restart before choosing.
- Remote transport and trust: direct TLS/auth, SSH tunnel, discovery, and credential storage. No unauthenticated LAN listener by default.
- Whether a multi-host view merely aggregates local indexes or later syncs selected knowledge. The default is no cross-host knowledge replication.
- First external harness and its exact integration protocol. Confirm capabilities from source and a small fixture before selecting.
- Packaging matrix, compatibility with older hosts, license review, and release size targets. These need actual builds and measurements.

## References

- GPUI: https://github.com/zed-industries/zed/blob/main/crates/gpui/README.md
- GPUI Kit: https://gpui-kit.com/docs/ and https://gpui-kit.com/component/message-scroller.md
- Existing host and extraction boundaries: `.architecture-v2/00-principles.md`, `.architecture-v2/09-decisions.md`
- Existing embedded client plan: `docs/plans/embedded-client-server.md`
