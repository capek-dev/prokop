// Re-export everything from shared
export * from './shared';

export { ProkopaiClient } from './client';
export { TypedEventEmitter } from './emitter';
export type { EventMap } from './emitter';

export {
  ProkopaiError,
  ConnectionError,
  AuthError,
  RateLimitError,
  TimeoutError,
  ServerError,
  ValidationError,
  ApiError,
} from './errors';

export { version } from './version';

export type { SdkEventMap } from './types/server-messages';
export { routeServerMessage } from './types/server-messages';

export { WebSocketTransport } from './transport/websocket';
export type { WebSocketTransportConfig, WsState } from './transport/websocket';

export { HttpClient } from './transport/http';
export type { HttpClientConfig } from './transport/http';

export { SessionsNamespace } from './namespaces/sessions';
export { ChatNamespace } from './namespaces/chat';
export { PermissionsNamespace } from './namespaces/permissions';
export { QueueNamespace } from './namespaces/queue';
export { ProvidersNamespace } from './namespaces/providers';
export { ControlNamespace } from './namespaces/control';
export { NotificationsNamespace } from './namespaces/notifications';

export {
  TerminalConnection,
  TerminalEventsConnection,
  TerminalNamespace,
  TERMINAL_OPCODES,
} from './namespaces/terminal';
export type {
  TerminalEventMap,
  TerminalEventsEventMap,
  TerminalConnectOptions,
  TerminalConfig,
  TerminalOpcode,
  TerminalEventsSubscription,
} from './namespaces/terminal';

export { SessionsRestNamespace } from './rest/sessions';
export { WorkspacesRestNamespace } from './rest/workspaces';
export { ToolsRestNamespace } from './rest/tools';
export { PromptsRestNamespace } from './rest/prompts';
export { ModelsRestNamespace } from './rest/models';
export { PreconfigsRestNamespace } from './rest/preconfigs';
export { ProvidersRestNamespace } from './rest/providers';
export { FilesRestNamespace } from './rest/files';
export { AttachmentsRestNamespace } from './rest/attachments';
export { TerminalsRestNamespace } from './rest/terminals';
export { McpRestNamespace } from './rest/mcp';
export { ConfigRestNamespace } from './rest/config';
export { ConfigModelsNamespace, ConfigPromptsNamespace } from './rest/config';
export { ResponseFormatsRestNamespace } from './rest/response-formats';
export type { CreateResponseFormatRequest, UpdateResponseFormatRequest } from './rest/response-formats';
export { SchedulerRestNamespace } from './rest/scheduler';
export type { ListScheduledJobsResponse, GetScheduledJobResponse } from './rest/scheduler';
export { NotificationsRestNamespace } from './rest/notifications';
export { HttpNamespace } from './rest/http-namespace';
export type { LoadAllResult, CriticalServerData, SecondaryServerData } from './rest/http-namespace';

export type { ClientConfig, ConnectionState, SdkEvent } from './types';
