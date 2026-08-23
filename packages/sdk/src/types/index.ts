// Domain types
export type {
  Session,
  SessionStatus,
  SubagentStatus,
  AutoApproveSeverity,
} from '../shared';

export type {
  Message,
  UserMessage,
  AssistantMessage,
  SystemMessage,
  MessageRole,
  AssistantStatus,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  ImagePart,
  StepPart,
  CompactionPart,
  MessageWithParts,
  QueuedMessage,
  PartField,
  MessageEvent,
} from '../shared';

export type { Workspace, WorkspaceSettings, WorkspaceMemorySettings } from '../shared';
export type { Preconfig, PreconfigMode } from '../shared';
export type { PromptInfo } from '../shared';

export type {
  PermissionType,
  PermissionScope,
  GrantScope,
  GrantMatcher,
  PermissionGrant,
  PermissionGrantOptions,
  PermissionDecision,
  AskPermissionResponse,
  PermissionAsk,
  PermissionScopeDefinition,
  PermissionAction,
  PermissionResource,
  PermissionRiskLevel,
  PermissionRisk,
} from '../shared';

export type {
  SessionInterruptResult,
  InterruptReason,
  InterruptState,
} from '../shared';

export type {
  ToolDefinition,
  ToolEnvVarStatus,
  EnvVarSource,
  EnvVarLink,
  ToolResult,
  ToolModule,
  ToolContext,
  FileSystemApi,
  DirEntry,
  FileStat,
  LlmApi,
  LlmTextOptions,
  LlmStructuredOptions,
  LlmImage,
  AskApi,
  SingleSelectQuestion,
  MultiSelectQuestion,
  TextQuestion,
  ConfirmQuestion,
  FormQuestion,
  HumanQuestion,
  ClientCapabilityAsk,
  Ask,
  AskTarget,
  AskSingleSelectResponse,
  AskMultiSelectResponse,
  AskTextResponse,
  AskConfirmResponse,
  AskFormResponse,
  AskClientCapabilityResponse,
  AskResponse,
  EnvApi,
  ToolLogger,
  LoadedTool,
  BufferEncoding,
} from '../shared';

export type {
  ModelDefinition,
  ModelTier,
  ProviderDefinition,
  ModelWithProvider,
  ModelsConfig,
  AttachmentKind,
  ModelCapabilities,
} from '../shared';

export type {
  ProviderStatus,
  AuthType,
  ProviderDescriptor,
} from '../shared';

// Protocol types
export type {
  SessionControlStatus,
  SessionControlState,
  SessionParticipantInfo,
  AskAuthority,
  ClientCapability,
} from '../shared';

export {
  WELL_KNOWN_CLIENT_CAPABILITIES,
} from '../shared';

export type {
  SessionControlUpdatedMessage,
  SessionControlUpdateReason,
  SessionActionRejectedMessage,
  ControllerGatedAction,
} from '../shared';

export type {
  ClientDescriptor,
  ClientMessage,
  ClientRegisterMessage,
  SessionControlClaimMessage,
  SessionControlReleaseMessage,
  SessionCreateMessage,
  SessionResumeMessage,
  ChatMessage,
  ChatMessageAttachment,
  SessionCloseMessage,
  SessionUpdateMessage,
  SessionUpdateModelMessage,
  SessionReopenMessage,
  SessionDeleteMessage,
  SessionRenameMessage,
  PermissionListRequestMessage,
  PermissionRevokeMessage,
  PermissionRevokeAllMessage,
  SessionCompactMessage,
  SessionRevertMessage,
  SessionForkMessage,
  SessionInterruptMessage,
  QueueAddMessage,
  QueueRemoveMessage,
  ProviderConnectMessage,
  ProviderDisconnectMessage,
  AskResponseMessage,
  ServerMessage,
} from '../shared';

// Individual server message types
export type {
  ClientRegisteredMessage,
  ClientRejectedMessage,
  SessionCreatedMessage,
  SessionResumedMessage,
  MessageCreatedMessage,
  MessageUpdatedMessage,
  PartCreatedMessage,
  PartUpdatedMessage,
  PartAppendMessage,
  SessionClosedMessage,
  SessionUpdatedMessage,
  SessionReopenedMessage,
  SessionDeletedMessage,
  SessionRenamedMessage,
  SessionInterruptedMessage,
  SessionRevertedMessage,
  SessionForkedMessage,
  SessionStateMessage,
  ChatUsageMessage,
  CompactionCompleteMessage,
  PermissionListMessage,
  PermissionRevokedMessage,
  PermissionAllRevokedMessage,
  QueueListMessage,
  QueueAddedMessage,
  QueueRemovedMessage,
  QueueSendingMessage,
  ProviderStatusMessage,
  ProviderConnectedMessage,
  AskRequestMessage,
  AskTimedOutMessage,
  AskResponseRejectedMessage,
  AskPendingSyncMessage,
  ErrorMessage,
  RateLimitErrorMessage,
  ServerErrorMessage,
  TimeoutErrorMessage,
  AuthErrorMessage,
  InvalidRequestErrorMessage,
  ContextOverflowErrorMessage,
} from '../shared';

// Terminal types
export type {
  TerminalSessionInfo,
  TerminalSessionInit,
  TerminalEvent,
} from '../shared';

// Type guards
export {
  isTextPart,
  isToolPart,
  isReasoningPart,
  isStepPart,
  isImagePart,
  isFilePart,
  isCompactionPart,
  isAssistantMessage,
  isUserMessage,
} from '../shared';

// Configuration types
export type {
  ModelWithStatus,
  ModelsConfigResponse,
  ProviderWithStatus,
  ProviderCredentialStatus,
  ProviderCredentialsResponse,
  CreateProviderRequest,
  UpdateProviderRequest,
  CreateModelRequest,
  UpdateModelRequest,
  SetDefaultsRequest,
  CreatePromptRequest,
  UpdatePromptRequest,
} from '../shared';

// File types
export type {
  FileEntry,
  FileListResponse,
  FileSearchResult,
  FilePreviewKind,
  FilePreviewResponse,
  FilePreviewContentResponse,
  EditableFileResponse,
  FileRevisionConflictDetails,
  SaveFileRequest,
} from '../shared';

// MCP types
export type {
  McpServerConfig,
  McpConfig,
  McpStatus,
  McpServerInfo,
} from '../shared';

// Visualization types
export type {
  VisualizationType,
  ToolVisualization,
  AnyVisualization,
} from '../shared';

// SDK-specific types
export type { ClientConfig, ConnectionState, SdkEvent } from './sdk-types';
export type { SdkEventMap } from './server-messages';

// REST response types
export type {
  ListSessionsResponse,
  ListSessionsGroupedResponse,
  CreateSessionResponse,
  GetSessionResponse,
  UpdateSessionResponse,
  DeleteSessionResponse,
  ListMessagesResponse,
  GetToolDebugResponse,
  ListWorkspacesResponse,
  CreateWorkspaceResponse,
  GetWorkspaceResponse,
  UpdateWorkspaceResponse,
  DeleteWorkspaceResponse,
  ListWorkspaceSessionsResponse,
  ListToolsResponse,
  GetToolResponse,
  ListToolEnvVarsResponse,
  SetToolEnvVarResponse,
  ClearToolEnvVarResponse,
  ListModelsResponse,
  ListPromptsResponse,
  ListProvidersResponse,
  GetProviderStatusResponse,
  ConnectProviderResponse,
  DisconnectProviderResponse,
  ListCredentialsResponse,
  SetCredentialResponse,
  ClearCredentialResponse,
  ListPreconfigsResponse,
  GetPreconfigResponse,
  CreatePreconfigResponse,
  UpdatePreconfigResponse,
  DeletePreconfigResponse,
  ListAttachmentsResponse,
  UploadAttachmentResponse,
  BrowseFilesResponse,
  SearchFilesResponse,
  PreviewFileResponse,
  ReadEditableFileResponse,
  SaveFileResponse,
  BrowseFsResponse,
  FsParentResponse,
  ListDrivesResponse,
  ListTerminalSessionsResponse,
  CreateTerminalSessionResponse,
  GetTerminalSessionResponse,
  DeleteTerminalSessionResponse,
  GetMcpStatusResponse,
  ConnectMcpServerResponse,
  DisconnectMcpServerResponse,
  StartMcpAuthResponse,
  FinishMcpAuthResponse,
  GetModelsConfigResponse,
  CreateProviderResponse,
  UpdateProviderResponse,
  DeleteProviderResponse,
  CreateModelResponse,
  UpdateModelResponse,
  DeleteModelResponse,
  SetDefaultsResponse,
  ListPromptConfigsResponse,
  GetPromptConfigResponse,
  CreatePromptConfigResponse,
  UpdatePromptConfigResponse,
  DeletePromptConfigResponse,
  GetNotificationConfigResponse,
  UpsertSubscriptionResponse,
  UpdateSubscriptionPreferencesResponse,
  DeleteSubscriptionResponse,
} from './rest-responses';
