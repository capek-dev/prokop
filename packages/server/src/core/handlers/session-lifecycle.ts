/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handleCreateSession,
  handleResumeSession,
  handleUpdateSession,
  handleUpdateModelSession,
  handleCloseSession,
  handleReopenSession,
  handleDeleteSession,
  handleRenameSession,
  handleGenerateTitleSession,
  handleInterruptSession,
} from '@/transport/websocket/handlers/session-lifecycle';
