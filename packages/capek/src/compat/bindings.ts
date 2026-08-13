import type { Tool } from 'ai';
import type {
  AskApi,
  AskAuthority,
  AskRequestMessage,
  AssistantMessage,
  AutoApproveSeverity,
  AskTimedOutMessage,
  AttachmentKind,
  Message,
  MessageWithParts,
  Part,
  PermissionAsk,
  PermissionRiskLevel,
  Preconfig,
  QueuedMessage,
  ResponseFormat,
  ScheduledJob,
  ServerMessage,
  Session,
  ToolPart,
  Workspace,
} from '@jean2/sdk';
import type { LlmCallContext, SandboxResponse } from '../sandbox/types';
import type { WorkspaceCapabilityHost } from '../tools/workspace-capability';
import type {
  ConnectableProvider,
  ModelFactoryOptions,
  ModelFactoryResult,
} from '../sandbox/provider-types';

export interface Jean2ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  tier: 'budget' | 'standard' | 'premium';
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: {
      text?: boolean;
      image?: boolean;
      video?: boolean;
      file?: string[];
    };
    structuredOutput?: { mode: 'native' | 'prompt' };
  };
  providerId: string;
  providerName: string;
}

export interface Jean2ModelsConfig {
  providers: Array<{
    id: string;
    name: string;
    models: Array<Omit<Jean2ModelDefinition, 'providerId' | 'providerName'>>;
  }>;
  defaultModel: string;
  defaultProvider: string;
}

export interface StreamingPartSnapshot {
  id: string;
  messageId: string;
  sessionId: string;
  type: 'text' | 'reasoning';
  createdAt: number;
  text: string;
}

export interface Jean2Attachment {
  id: string;
  sessionId: string;
  workspaceId: string;
  kind: AttachmentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  absolutePath: string;
  createdAt: string;
  accessKey: string;
}

export interface EffectiveContextHistory {
  messages: MessageWithParts[];
  latestCompactionBoundary: string | null;
  hasCompaction: boolean;
}

export interface TranscriptPageResult {
  messages: MessageWithParts[];
  pagination: {
    hasOlder: boolean;
    oldestSequence: number | null;
    newestSequence: number | null;
    limit: number;
  };
}

export interface Jean2StoreBindings {
  createSession(session: Omit<Session, 'createdAt' | 'updatedAt'> & { createdAt?: string; updatedAt?: string }): Session;
  createMessage(message: Message): Message;
  getMessage(id: string): Message | null;
  getMessageWithParts(messageId: string): MessageWithParts | null;
  deleteMessage(messageId: string): boolean;
  updateMessage(id: string, updates: Partial<Message>, options?: { syncFts?: boolean }): Message | null;
  getSession(id: string): Session | null;
  updateSession(
    id: string,
    updates: Partial<Pick<Session, 'title' | 'status' | 'metadata' | 'preconfigId' | 'selectedModel' | 'selectedProvider' | 'selectedVariant' | 'promptTokens' | 'completionTokens' | 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'noCacheTokens' | 'parentId' | 'agentName' | 'subagentStatus' | 'runningAt' | 'compacting' | 'tags' | 'autoApproveSeverity' | 'agentId'>>,
  ): Session | null;
  transitionToolToInterrupted(partId: string, reason: 'user_request' | 'timeout' | 'error' | 'cascade'): ToolPart | null;
  syncMessageFts(messageId: string): void;
  getPartsByMessage(messageId: string): Part[];
  createPart(part: Part, sessionId: string, options?: { syncFts?: boolean }): Part;
  updatePart(id: string, updates: Record<string, unknown>, options?: { syncFts?: boolean }): Part | null;
  getPart(id: string): Part | null;
  persistStreamingPartSnapshots(snapshots: StreamingPartSnapshot[]): number;
  getAttachment(sessionId: string, attachmentId: string): Jean2Attachment | null;
  getWorkspace(id: string): Workspace | null;
  updateWorkspace(
    id: string,
    updates: { name?: string; additionalPaths?: string[]; settings?: Workspace['settings'] },
  ): Workspace | null;
  transitionToolToRunningByCallId(sessionId: string, callId: string, childSessionId?: string): ToolPart | null;
  getChildSessions(parentId: string): Session[];
  listMessagesWithParts(sessionId: string): MessageWithParts[];
  listLatestMessagesWithPartsPage(sessionId: string, limit?: number): TranscriptPageResult;
  getPartsBySession(sessionId: string): Part[];
  buildEffectiveContextHistory(sessionId: string): EffectiveContextHistory;
  addMessageToQueue(sessionId: string, content: string, attachments?: Array<{ id: string; kind: string }>): QueuedMessage;
  deleteQueuedMessage(id: string): boolean;
  getNextQueuedMessage(sessionId: string): QueuedMessage | null;
  getResponseFormat(id: string): ResponseFormat | null;
  getWorkspaceAutoApproveSeverity(workspaceId: string): AutoApproveSeverity;
}

export interface Jean2ConfigBindings {
  findModel(modelId: string, providerId?: string): Jean2ModelDefinition | undefined;
  getMaxOutputTokens(modelId?: string): number;
  findModelVariant(modelId: string, variantKey: string, providerId?: string): Record<string, unknown> | undefined;
  getModelsConfig(): Jean2ModelsConfig;
  resolveToolsPath(): string;
  getPreconfig(id: string): Promise<Preconfig | null>;
  getDefaultPreconfig(): Promise<Preconfig | null>;
  getPreconfigOrAgent(id: string): Promise<Preconfig | null>;
  listPreconfigs(): Promise<Preconfig[]>;
  listSubagentPreconfigs(): Promise<Preconfig[]>;
}

export interface Jean2EnvBindings {
  getCompactionAutoThresholdRatio(): number;
  getCompactionAutoReserveCapTokens(): number;
  getCompactionAutoSafetyMarginTokens(): number;
  getLLMTemperature(): number;
  getLLMMaxSteps(): number;
  getLLMSubagentMaxSteps(): number;
  getLLMBaseUrl(): string | undefined;
  getLLMOpenAIApiKey(): string | undefined;
  getLLMOpenRouterApiKey(): string | undefined;
  getLLMMinimaxApiKey(): string | undefined;
  getLLMZhipuApiKey(): string | undefined;
  getLLMZhipuCodingApiKey(): string | undefined;
  getLLMDeepseekApiKey(): string | undefined;
  getJean2EnvValue(key: string): string | undefined;
  getCompactionModel(): string | undefined;
  getCompactionProvider(): string | undefined;
  getCompactionMaxTokens(): number;
  getCompactionPreserveRecentToolCount(): number;
  getCompactionPreserveSmallToolChars(): number;
  getCompactionToolClearCharsThreshold(): number;
  getCompactionMaxPrunedToolCount(): number;
}

export interface Jean2ProviderBindings {
  getProvider(id: string): ConnectableProvider | undefined;
  createModelForProvider(options: ModelFactoryOptions): Promise<ModelFactoryResult>;
}

export type AskBroadcastFn = (message: AskRequestMessage | AskTimedOutMessage) => void;
export type BroadcastFn = (message: ServerMessage) => void;
export type BroadcastSessionFn = (session: Session) => void;

export interface Jean2AskBindings {
  createAskApi(
    sessionId: string,
    toolCallId: string,
    toolName: string,
    broadcastFn: AskBroadcastFn,
    workspaceId?: string,
    rootSessionId?: string,
  ): AskApi;
  rejectPendingAsksBySession(sessionId: string, error?: Error): string[];
  rejectPendingAsksByToolCallId(toolCallId: string, error?: Error): string[];
}

export interface Jean2DeliveryBindings {
  broadcastEvent(message: ServerMessage): void;
  broadcastSessionCreated(session: Session): void;
  broadcastSessionUpdated(session: Session): void;
  broadcastToSessionEvent(sessionId: string, message: ServerMessage): void;
  sendToControllerEvent(sessionId: string, message: ServerMessage): void;
  sendToAskTargetsEvent(sessionId: string, authority: AskAuthority, message: ServerMessage): void;
  notifyTerminalMessage(message: AssistantMessage, sessionId: string): void;
}

export interface Jean2TitleBindings {
  isDefaultSessionTitle(title: string | null | undefined): boolean;
  hasManualSessionTitle(metadata: Record<string, unknown> | null | undefined): boolean;
  generateSessionTitle(messages: MessageWithParts[]): Promise<string | null>;
}

export interface Jean2AgentBindings {
  getAgentDirectory(id: string): Promise<string | null>;
  readAgentMemoryFile(agentId: string, filename: 'USER.md' | 'MEMORY.md'): Promise<string | null>;
}

export interface Jean2McpBindings {
  initializeWorkspace(workspacePath: string): Promise<void>;
  getTools(workspacePath: string, sessionId?: string): Promise<Record<string, Tool>>;
}

export interface Jean2WorkspaceCapabilityBindings {
  createToolWorkspaceHost(options: {
    workspaceId?: string;
    workspacePath?: string;
    additionalPaths?: string[];
    sessionId: string;
  }): WorkspaceCapabilityHost;
}

export interface Jean2InstallManifest {
  toolName: string;
  toolVersion: string | null;
  installedAt: string;
  entry: string;
  runtime: 'bun';
  installStrategy: 'source+npm' | 'source+npm+bundle';
  sourceUrl?: string;
  sourcePath?: string;
  artifactSha256?: string;
  packageName?: string;
  packageVersion?: string;
  sdkVersion?: string;
  sdkIntegrity?: string;
}

export interface Jean2ToolManifestBindings {
  readInstallManifest(toolsDir: string, toolName: string): Jean2InstallManifest | null;
}

export interface ToolDefinitionValue {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  timeout?: number;
}

export interface MemoryActionResult {
  success: boolean;
  result?: {
    action: string;
    target: string;
    [key: string]: unknown;
  };
  entries?: unknown;
  usage?: unknown;
  error?: string;
}

export interface Jean2MemoryBindings {
  memoryToolDefinition: ToolDefinitionValue;
  executeMemoryTool(
    input: Record<string, unknown>,
    basePath: string,
    permissionRisk: PermissionRiskLevel,
    askFn?: (ask: PermissionAsk) => Promise<unknown>,
  ): Promise<MemoryActionResult>;
  loadMemoryInstructions(workspacePath: string): Promise<string | null>;
  MEMORY_GUIDANCE: string;
}

export interface SkillManageResult {
  success: boolean;
  title?: string;
  action?: string;
  name?: string;
  description?: string;
  path?: string;
  summary?: string;
  skills?: Array<{ name: string; description: string }>;
  error?: string;
}

export interface Jean2SkillBindings {
  skillManageToolDefinition: ToolDefinitionValue;
  executeSkillManageTool(
    input: Record<string, unknown>,
    skillsDir: string,
    permissionRisk: PermissionRiskLevel,
    askFn?: (ask: PermissionAsk) => Promise<unknown>,
  ): Promise<SkillManageResult>;
  buildSkillManageToolDescription(skillsDir: string): Promise<string>;
  createSkillTool(
    workspacePath: string,
    allowedSkills: string[] | null | undefined,
    sessionId: string,
    agentSkillsDir?: string,
  ): Promise<{ name: string; tool: Tool } | null>;
  SKILL_MANAGE_GUIDANCE: string;
}

export interface SessionSearchResult {
  success: boolean;
  mode: 'list' | 'search' | 'read';
  title: string;
  sessions?: unknown[];
  query?: string;
  scope?: string;
  results?: unknown[];
  sessionId?: string;
  sessionTitle?: string | null;
  anchorMessageId?: string;
  anchorInferred?: boolean;
  messagesBefore?: number;
  messagesAfter?: number;
  messages?: unknown[];
  error?: string;
}

export interface Jean2SessionSearchBindings {
  sessionSearchToolDefinition: ToolDefinitionValue;
  executeSessionSearchTool(
    input: Record<string, unknown>,
    workspaceId: string,
    currentSessionId: string,
    includeToolResults: boolean,
    permissionRisk: PermissionRiskLevel,
    askFn?: (ask: PermissionAsk) => Promise<unknown>,
    agentId?: string | null,
  ): Promise<SessionSearchResult>;
  SESSION_SEARCH_GUIDANCE: string;
}

export interface SchedulerToolResult {
  success: boolean;
  action: string;
  title: string;
  job?: ScheduledJob;
  jobs?: ScheduledJob[];
  jobId?: string;
  error?: string;
}

export interface Jean2SchedulerBindings {
  schedulerToolDefinition: ToolDefinitionValue;
  executeSchedulerTool(
    input: Record<string, unknown>,
    workspaceId: string,
    currentSessionId: string,
    permissionRisk: PermissionRiskLevel,
    askFn?: (ask: PermissionAsk) => Promise<unknown>,
  ): Promise<SchedulerToolResult>;
}

export interface LoadedInstructions {
  global: string | null;
  project: string | null;
}

export interface Jean2ContextBindings {
  buildWorkspaceSystemPrompt(workspacePath: string, additionalPaths?: string[]): string;
  loadInstructions(workspacePath?: string): Promise<LoadedInstructions>;
  formatInstructions(instructions: LoadedInstructions): string | null;
}

export interface Jean2SandboxController {
  waitForResponse(context: LlmCallContext, abortSignal?: AbortSignal): Promise<SandboxResponse>;
  complete(callId: string): void;
  rejectAllPendingForSession(sessionId: string): string[];
}

export interface Jean2SandboxBindings {
  isSandboxActive(): boolean;
  sandboxController: Jean2SandboxController;
}

export interface Jean2CompatibilityBindings {
  store: Jean2StoreBindings;
  config: Jean2ConfigBindings;
  env: Jean2EnvBindings;
  providers: Jean2ProviderBindings;
  asks: Jean2AskBindings;
  delivery: Jean2DeliveryBindings;
  titles: Jean2TitleBindings;
  agents: Jean2AgentBindings;
  mcp: Jean2McpBindings;
  workspace: Jean2WorkspaceCapabilityBindings;
  tools: Jean2ToolManifestBindings;
  memory: Jean2MemoryBindings;
  skills: Jean2SkillBindings;
  sessionSearch: Jean2SessionSearchBindings;
  scheduler: Jean2SchedulerBindings;
  context: Jean2ContextBindings;
  sandbox: Jean2SandboxBindings;
}

let bindings: Jean2CompatibilityBindings | null = null;

export function setJean2CompatibilityBindings(value: Jean2CompatibilityBindings): void {
  bindings = value;
}

export function getJean2CompatibilityBindings(): Jean2CompatibilityBindings {
  if (!bindings) {
    throw new Error('Jean2 compatibility bindings have not been configured');
  }
  return bindings;
}
