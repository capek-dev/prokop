import type { Session, Message, Workspace, ToolDefinition, ToolEnvVarStatus, PromptInfo, ModelWithStatus, Preconfig, ProviderStatus, ProviderCredentialStatus, ModelsConfigResponse, ModelsConfig, FileEntry, FilePreviewResponse, TerminalSessionInfo, McpServerConfig, McpStatus, PinnedMessage, GitAvailability, GitDiffSummary, GitFileDiffResponse, EditableFileResponse, SaveFileResponse as SaveFileResultResponse, FileTreeResponse as FileTreeResultResponse, CreateFileResponse, RenameFileResponse, DeleteFileResponse, Agent, GitWorktreeRef, ManagedWorktree } from '../shared';
import type { NotificationConfig, PushSubscriptionRecord } from '../shared-types/notification';

/**
 * GET /api/sessions
 */
export interface SessionPageInfo {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

/**
 * GET /api/sessions
 */
export interface ListSessionsResponse {
  sessions: Session[];
  pagination?: SessionPageInfo;
}

/**
 * GET /api/sessions/grouped
 */
export interface ListSessionsGroupedResponse {
  sessions: Record<string, Session[]>;
  pagination?: Record<string, SessionPageInfo>;
}

/**
 * POST /api/sessions
 */
export interface CreateSessionResponse {
  session: Session;
}

/**
 * GET /api/sessions/:id
 */
export interface GetSessionResponse {
  session: Session;
}

/**
 * PUT /api/sessions/:id
 */
export interface UpdateSessionResponse {
  session: Session;
}

/**
 * DELETE /api/sessions/:id
 */
export interface DeleteSessionResponse {
  success: boolean;
}

/**
 * GET /api/sessions/:id/messages
 */
export interface ListMessagesResponse {
  messages: Message[];
}

/**
 * GET /api/sessions/:id/transcript
 */
export interface TranscriptPageInfo {
  hasOlder: boolean;
  oldestSequence: number | null;
  newestSequence: number | null;
  limit: number;
}

export interface TranscriptPageResponse {
  messages: import('../shared-types/message').MessageWithParts[];
  pagination: TranscriptPageInfo;
}

export interface GetToolDebugResponse {
  input: Record<string, unknown>;
  output?: unknown;
}

/**
 * GET /api/workspaces
 */
export interface ListWorkspacesResponse {
  workspaces: Workspace[];
}

/**
 * POST /api/workspaces
 */
export interface CreateWorkspaceResponse {
  workspace: Workspace;
}

/**
 * GET /api/workspaces/:id
 */
export interface GetWorkspaceResponse {
  workspace: Workspace;
}

/**
 * PATCH /api/workspaces/:id
 */
export interface UpdateWorkspaceResponse {
  workspace: Workspace;
}

/**
 * DELETE /api/workspaces/:id
 */
export interface DeleteWorkspaceResponse {
  success: boolean;
  deletedSessions: string[];
}

/**
 * GET /api/workspaces/:id/sessions
 */
export interface ListWorkspaceSessionsResponse {
  sessions: Session[];
}

export interface ListManagedWorktreesResponse {
  worktrees: ManagedWorktree[];
}

export interface ListGitWorktreeRefsResponse {
  refs: GitWorktreeRef[];
}

export interface ManagedWorktreeResponse {
  worktree: ManagedWorktree;
}

export interface SessionWorktreeResponse {
  session: Session;
}

/**
 * GET /api/tools
 *
 * Each entry carries `source`: 'builtin' (shipped with the server
 * binary) or 'installed' (resolved from the tools directory).
 */
export interface ListToolsResponse {
  tools: Array<ToolDefinition & { source: 'builtin' | 'installed' | 'domain' }>;
}

/**
 * GET /api/tools/:name
 */
export interface GetToolResponse {
  tool: ToolDefinition;
}

/**
 * GET /api/prompts
 */
export interface ListPromptsResponse {
  prompts: PromptInfo[];
}

/**
 * GET /api/models
 */
export interface ListModelsResponse {
  models: ModelWithStatus[];
  defaultModel: string;
  defaultProvider: string;
}

/**
 * GET /api/preconfigs
 */
export interface ListPreconfigsResponse {
  preconfigs: Preconfig[];
}

/**
 * POST /api/preconfigs
 */
export interface CreatePreconfigResponse {
  preconfig: Preconfig;
}

/**
 * GET /api/preconfigs/:id
 */
export interface GetPreconfigResponse {
  preconfig: Preconfig;
}

/**
 * PUT /api/preconfigs/:id
 */
export interface UpdatePreconfigResponse {
  preconfig: Preconfig;
}

/**
 * DELETE /api/preconfigs/:id
 */
export interface DeletePreconfigResponse {
  success: boolean;
}

/**
 * GET /api/providers
 */
export interface ListProvidersResponse {
  providers: ProviderStatus[];
}

/**
 * GET /api/providers/:providerId/status
 */
export interface GetProviderStatusResponse {
  status: ProviderStatus;
}

/**
 * POST /api/providers/:providerId/connect
 */
export interface ConnectProviderResponse {
  authorizationUrl: string;
  flowId?: string;
  redirectStrategy?: string;
  redirectUri?: string;
  status: ProviderStatus;
}

/**
 * POST /api/oauth/callback
 */
export interface CompleteOAuthResponse {
  success: boolean;
  provider?: string;
  error?: string;
}

/**
 * DELETE /api/providers/:providerId
 */
export interface DisconnectProviderResponse {
  success: boolean;
}

/**
 * GET /api/config/providers
 */
export interface ListCredentialsResponse {
  providers: ProviderCredentialStatus[];
}

/**
 * PUT /api/config/providers/:provider
 */
export interface SetCredentialResponse {
  provider: string;
  configured: boolean;
}

/**
 * DELETE /api/config/providers/:provider
 */
export interface ClearCredentialResponse {
  provider: string;
  configured: boolean;
}


// =============================================================================
// Config: Models Responses
// =============================================================================

/**
 * GET /api/config/models
 * Returns full models config with runtime status per model.
 */
export type GetModelsConfigResponse = ModelsConfigResponse;

/**
 * POST /api/config/models/providers
 * Returns the updated full models config after provider creation.
 */
export type CreateProviderResponse = ModelsConfig;

/**
 * PUT /api/config/models/providers/:id
 * Returns the updated full models config after provider update.
 */
export type UpdateProviderResponse = ModelsConfig;

/**
 * DELETE /api/config/models/providers/:id
 * Returns the updated full models config after provider deletion.
 */
export type DeleteProviderResponse = ModelsConfig;

/**
 * POST /api/config/models/providers/:id/models
 * Returns the updated full models config after model creation.
 */
export type CreateModelResponse = ModelsConfig;

/**
 * PUT /api/config/models/providers/:providerId/models/:modelId
 * Returns the updated full models config after model update.
 */
export type UpdateModelResponse = ModelsConfig;

/**
 * DELETE /api/config/models/providers/:providerId/models/:modelId
 * Returns the updated full models config after model deletion.
 */
export type DeleteModelResponse = ModelsConfig;

/**
 * PUT /api/config/models/defaults
 * Returns the updated full models config after setting defaults.
 */
export type SetDefaultsResponse = ModelsConfig;

/**
 * POST /api/config/models/sync
 * Returns the sync result with details about what was added.
 */
export interface SyncModelsResponse {
  mode: 'merge' | 'override';
  addedProviders: string[];
  addedModels: string[];
  totalProviders: number;
  totalModels: number;
}

// =============================================================================
// Config: Prompts Responses
// =============================================================================

/**
 * GET /api/config/prompts
 * Returns a list of all prompt configurations.
 */
export interface ListPromptConfigsResponse {
  prompts: PromptInfo[];
}

/**
 * GET /api/config/prompts/:name
 * Returns a single prompt configuration.
 */
export type GetPromptConfigResponse = PromptInfo;

/**
 * POST /api/config/prompts
 * Returns the created prompt configuration.
 */
export type CreatePromptConfigResponse = PromptInfo;

/**
 * PUT /api/config/prompts/:name
 * Returns the updated prompt configuration.
 */
export type UpdatePromptConfigResponse = PromptInfo;

/**
 * DELETE /api/config/prompts/:name
 */
export interface DeletePromptConfigResponse {
  success: boolean;
}


/**
 * Single attachment shape returned by the server (list + upload).
 */
export interface AttachmentItem {
  id: string;
  kind: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
}

/**
 * GET /api/sessions/:id/attachments
 */
export interface ListAttachmentsResponse {
  attachments: AttachmentItem[];
}

/**
 * POST /api/sessions/:id/attachments
 */
export type UploadAttachmentResponse = AttachmentItem;

/**
 * GET /api/workspaces/:id/files (browse mode)
 */
export interface BrowseFilesResponse {
  files: FileEntry[];
  currentPath: string;
  mode: 'browse';
  git?: GitAvailability;
}

/**
 * GET /api/workspaces/:id/files (search mode)
 */
export interface SearchFilesResponse {
  files: FileEntry[];
  currentPath: string;
  mode: 'search';
}

/**
 * GET /api/workspaces/:id/file-preview
 */
export type PreviewFileResponse = FilePreviewResponse;

/**
 * GET /api/workspaces/:id/file
 */
export type ReadEditableFileResponse = EditableFileResponse;

/**
 * PUT /api/workspaces/:id/file
 */
export type SaveFileResponse = SaveFileResultResponse;

/**
 * GET /api/workspaces/:id/files/tree
 */
export type FileTreeRestResponse = FileTreeResultResponse;

/**
 * POST /api/workspaces/:id/files/create
 */
export type CreateFileRestResponse = CreateFileResponse;

/**
 * POST /api/workspaces/:id/files/rename
 */
export type RenameFileRestResponse = RenameFileResponse;

/**
 * POST /api/workspaces/:id/files/delete
 */
export type DeleteFileRestResponse = DeleteFileResponse;

/**
 * GET /api/workspaces/:id/git/diff
 */
export type GitDiffFileResponse = GitFileDiffResponse;

/**
 * GET /api/workspaces/:id/git/status
 */
export interface GitStatusFile {
  path: string;
  git: GitDiffSummary;
}

export interface GitStatusResponse {
  availability: GitAvailability;
  files: GitStatusFile[];
  root: string;
}

/**
 * GET /api/fs/browse
 */
export interface BrowseFsResponse {
  files: FileEntry[];
  currentPath: string;
  mode: 'browse';
  isRoot: boolean;
}

/**
 * GET /api/fs/parent
 */
export interface FsParentResponse {
  files: FileEntry[];
  currentPath: string;
  mode: 'browse';
  isRoot: boolean;
}

/**
 * GET /api/fs/drives
 */
export interface ListDrivesResponse {
  drives: string[];
}

/**
 * GET /api/workspaces/:id/terminals
 */
export interface ListTerminalSessionsResponse {
  sessions: TerminalSessionInfo[];
}

/**
 * POST /api/workspaces/:id/terminals
 */
export interface CreateTerminalSessionResponse {
  session: TerminalSessionInfo;
}

/**
 * GET /api/workspaces/:id/terminals/:sessionId
 */
export type GetTerminalSessionResponse = TerminalSessionInfo;

/**
 * DELETE /api/workspaces/:id/terminals/:sessionId
 */
export interface DeleteTerminalSessionResponse {
  success: boolean;
}

// =============================================================================
// MCP Responses
// =============================================================================

/**
 * GET /api/workspaces/:id/mcp/status
 * Returns a keyed record of server name -> { config, status }
 */
export interface GetMcpStatusResponse {
  status: Record<string, { config: McpServerConfig | undefined; status: McpStatus }>;
}

/**
 * POST /api/workspaces/:id/mcp/connect
 */
export interface ConnectMcpServerResponse {
  status: McpStatus;
}

/**
 * POST /api/workspaces/:id/mcp/disconnect
 */
export interface DisconnectMcpServerResponse {
  success: boolean;
}

/**
 * POST /api/workspaces/:id/mcp/auth
 */
export interface StartMcpAuthResponse {
  authorizationUrl: string;
}

/**
 * POST /api/workspaces/:id/mcp/auth/callback
 */
export interface FinishMcpAuthResponse {
  status: McpStatus;
}

// =============================================================================
// Agents Responses
// =============================================================================

/** GET /api/agents */
export interface ListAgentsResponse {
  agents: Agent[];
}

/** GET /api/agents/:id */
export interface GetAgentResponse {
  agent: Agent;
}

/** POST /api/agents/:id/promote */
export interface PromoteAgentResponse {
  agent: Agent;
}

/** DELETE /api/agents/:id */
export interface DeleteAgentResponse {
  success: boolean;
}

/** GET /api/agents/:id/memory */
export interface GetAgentMemoryResponse {
  user: string;
  memory: string;
}

/** PATCH /api/agents/:id/memory */
export interface UpdateAgentMemoryResponse {
  success: boolean;
}

// =============================================================================
// Tool Env Vars Responses
// =============================================================================

/**
 * GET /api/tools/env
 */
export interface ListToolEnvVarsResponse {
  envVars: ToolEnvVarStatus[];
}

/**
 * PUT /api/tools/env/:key
 */
export interface SetToolEnvVarResponse {
  envVar: ToolEnvVarStatus;
}

/**
 * DELETE /api/tools/env/:key
 */
export interface ClearToolEnvVarResponse {
  envVar: ToolEnvVarStatus;
}

// =============================================================================
// Pinned Messages Responses
// =============================================================================

/**
 * GET /api/workspaces/:id/pinned-messages
 */
export interface ListPinnedMessagesResponse {
  pinnedMessages: PinnedMessage[];
}

/**
 * POST /api/workspaces/:id/pinned-messages
 */
export interface PinMessageResponse {
  pinnedMessage: PinnedMessage;
}

/**
 * DELETE /api/workspaces/:id/pinned-messages/:messageId
 */
export interface UnpinMessageResponse {
  success: boolean;
}

// =============================================================================
// Notifications Responses
// =============================================================================

/**
 * GET /api/notifications/config
 * Returns public notification configuration (VAPID public key, timeouts).
 */
export type GetNotificationConfigResponse = NotificationConfig;

/**
 * PUT /api/notifications/subscriptions
 * Authenticated upsert using endpoint uniqueness.
 * Returns an opaque subscription record without endpoint or encryption keys.
 */
export interface UpsertSubscriptionResponse {
  subscription: PushSubscriptionRecord;
}

/**
 * PATCH /api/notifications/subscriptions/:id
 * Update event preferences for a subscription.
 */
export interface UpdateSubscriptionPreferencesResponse {
  subscription: PushSubscriptionRecord;
}

/**
 * DELETE /api/notifications/subscriptions/:id
 * Delete the server registration.
 */
export interface DeleteSubscriptionResponse {
  success: boolean;
}
