import { createContext, useContext } from 'react';
import type {
  Workspace,
  WorkspaceSettings,
  AttachmentKind,
  AskResponse,
} from '@prokopai/sdk';
import type { ResumeSessionOptions } from '@/stores/sessionStore';

/**
 * Stable command functions that don't change on data updates.
 * These are extracted from useServerSessionManager into a separate context
 * so consumers that only need commands don't rerender on streaming/ask/queue changes.
 */
export interface SessionCommandsValue {
  createSession: (preconfigId?: string, title?: string) => void;
  resumeSession: (sessionId: string, options?: ResumeSessionOptions) => void;
  openAlongside: (sessionId: string) => void;
  closeSession: (sessionId: string) => void;
  reopenSession: (sessionId: string) => void;
  permanentlyDeleteSession: (sessionId: string) => void;
  handleRenameSession: (sessionId: string, title: string) => void;
  regenerateSessionTitle: (sessionId: string) => void;
  revertSession: (sessionId: string, messageId: string) => void;
  forkSession: (sessionId: string, messageId: string) => void;
  editMessage: (sessionId: string, messageId: string, content: string) => void;
  compactSession: (sessionId: string) => void;
  removeFromQueue: (queueId: string) => void;
  sendChatMessage: (
    content: string,
    attachments?: Array<{ id: string; kind: AttachmentKind }>,
    responseFormatId?: string,
    goal?: { condition: string; maxTurns?: number },
  ) => void;
  sendChatMessageForSession: (
    sessionId: string,
    content: string,
    attachments?: Array<{ id: string; kind: AttachmentKind }>,
    responseFormatId?: string,
    goal?: { condition: string; maxTurns?: number },
  ) => void;
  handleAskResponse: (toolCallId: string, response: AskResponse, requestId?: string) => void;
  handleInterruptSession: () => void;
  handleInterruptSessionById: (sessionId: string) => void;
  updateSessionPreconfig: (preconfigId: string) => void;
  updateSessionPreconfigForSession: (sessionId: string, preconfigId: string) => void;
  updateSessionModel: (modelId: string, providerId: string) => void;
  updateSessionModelForSession: (sessionId: string, modelId: string, providerId: string) => void;
  updateSessionVariant: (variant: string | null) => void;
  updateSessionVariantForSession: (sessionId: string, variant: string | null) => void;
  handleNavigateBack: () => void;

  selectWorkspace: (workspace: Workspace) => void;
  renameWorkspace: (id: string, name: string) => void;
  updateWorkspacePaths: (id: string, additionalPaths: string[]) => void;
  updateWorkspaceSettings: (id: string, settings: WorkspaceSettings) => void;
  handleCreateVirtualWorkspace: () => void;
  handleCreatePhysicalWorkspace: (path: string) => void;
  deleteWorkspace: (id: string) => void;
  createSessionInWorkspace: (workspaceId: string) => void;

  claimControl: (sessionId: string) => void;

  handleLogout: () => void;
  handleRetry: () => void;
  refreshPermissions: () => void;
  revokePermission: (permissionId: string) => void;
  revokeAllPermissions: (workspaceId: string) => void;
}

const SessionCommandsContext = createContext<SessionCommandsValue | null>(null);

export const SessionCommandsProvider = SessionCommandsContext.Provider;

export function useSessionCommands(): SessionCommandsValue {
  const ctx = useContext(SessionCommandsContext);
  if (!ctx) {
    throw new Error('useSessionCommands must be used within a SessionCommandsProvider');
  }
  return ctx;
}
