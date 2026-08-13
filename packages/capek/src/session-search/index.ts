export * from './host';
export * from './session-search-tool';

export const SESSION_SEARCH_GUIDANCE = `You can use session_search to recall prior conversation details from the current workspace or current session archive.
Use it when the user references past work, says "we did this before", asks what happened earlier, or when compaction may have removed exact details from active context.

Three modes:
1. List mode (action: "list"): Enumerate recent sessions in the workspace. Returns session IDs, titles, and message counts. Use this to discover what exists.
2. Search mode (provide "query"): Full-text search across messages.
3. Read mode (provide "sessionId"): Read the latest context from a session. Optionally provide "aroundMessageId" to anchor at a specific message.

Search scopes:
- scope="current_session": Search only this session archive.
- scope="workspace": Search all sessions in the current workspace (default).
- scope="agent": Search YOUR past sessions across ALL workspaces. Use this to recall work from other projects.

Typical workflow: list sessions, then read a session's latest context, then search for specific keywords if needed.
Prefer scope="current_session" when looking for details from earlier in this same conversation.
Prefer scope="workspace" when looking for related previous sessions in this workspace.
Use scope="agent" when you need to recall work from a different project.
Do not ask the user to repeat information until you have searched likely prior context.
Search results are snippets; use read mode with sessionId to get full surrounding context.
Default search focuses on user/assistant messages. Include tool results only when exact tool output, commands, errors, or logs are relevant.`;
