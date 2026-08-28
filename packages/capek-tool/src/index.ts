import type { AnyVisualization } from '@capekai/types';

// Import permission types for use in this file
import type {
  PermissionAsk,
  AskPermissionResponse,
} from '@capekai/types';

// Export values from permission module (constants and functions)
export {
  SHELL_DANGEROUS_COMMANDS,
  SHELL_FILESYSTEM_COMMANDS,
  SHELL_SHELL_OPERATORS,
  SENSITIVE_FILE_PATTERNS,
  createShellPermissionAskStructured,
  createOutsideWorkspaceAsk,
  createWorkspaceModificationAsk,
  type ShellRiskCategory,
} from '@capekai/types';

// =============================================================================
// Re-exports from canonical permission contract
// =============================================================================

export type {
  PermissionAction,
  PermissionResource,
  PermissionRiskLevel,
  PermissionRisk,
  PermissionScope,
  PermissionScopeDefinition,
  GrantScope,
  GrantMatcher,
  PermissionGrant,
  PermissionGrantOptions,
  SecurityCheckInput,
  SecurityCheckResult,
  PermissionAsk,
  AskPermissionResponse,
  PermissionDecision,
} from '@capekai/types';

export type BufferEncoding = 'utf-8' | 'ascii' | 'utf-16le' | 'ucs2' | 'base64' | 'hex' | 'latin1' | 'binary';

// ===========================================
// Tool Definition (new module format)
// ===========================================

export interface ToolDisplayConfig {
  /**
   * Template for the collapsed tool-call row summary, resolved against
   * input args with `{field}` placeholders (e.g. `'{command}'`, `'{path}'`).
   * Missing fields resolve to an empty string. When absent, the client
   * falls back to truncated input JSON.
   */
  summary?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** Execution deadline in milliseconds. `null` disables the deadline:
   * the tool runs until it settles or is interrupted. Omit to use the
   * executor default (30s). */
  timeout?: number | null;
  env?: string[];
  capabilities?: string[];
  /**
   * Client display hints declared by the tool itself. Not consumed by
   * the server runtime; travels verbatim through the tool catalog to
   * clients that choose to use it.
   */
  display?: ToolDisplayConfig;
}

// ===========================================
// Tool Result
// ===========================================

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  visualization?: AnyVisualization;
  interrupted?: boolean;
  partialOutput?: string;
}

// ===========================================
// Tool Execution Context (for tool execution)
// ===========================================

export interface ToolExecutionContext {
  workspacePath?: string;
  sessionId: string;
  workspaceId?: string;
  allowedPaths?: string[];
}

// ===========================================
// Tool Module (what a tool.ts exports)
// ===========================================

export interface ToolModule {
  definition: ToolDefinition;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ===========================================
// Tool Context (full capabilities)
// ===========================================

export interface ToolContext {
  sessionId: string;
  workspacePath: string;
  workspaceId?: string;
  abortSignal: AbortSignal;
  allowedPaths: string[];

  fs: FileSystemApi;
  llm: LlmApi;
  ask: AskApi;
  env: EnvApi;
  logger: ToolLogger;
  fetch: typeof globalThis.fetch;

  resolvePath(path: string): string;
  isWithinWorkspace(path: string): boolean;
  isSensitivePath(path: string): boolean;
  isBlockedPath(path: string): boolean;

  /**
   * Add a path to the current workspace's additionalPaths. This makes the
   * path accessible to all subsequent tool calls within this workspace without
   * requiring per-call permission approval.
   *
   * Used by tools like git-worktree to register isolated working directories.
   * Returns false if no workspace is associated with this session.
   */
  addWorkspacePath(path: string): Promise<boolean>;

  /**
   * Remove a path from the current workspace's additionalPaths.
   *
   * The inverse of addWorkspacePath. Used to clean up when a worktree is
   * removed or its lifecycle ends.
   * Returns false if no workspace is associated with this session.
   */
  removeWorkspacePath(path: string): Promise<boolean>;
}

// ===========================================
// FileSystem API
// ===========================================

export interface FileSystemApi {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  appendFile(path: string, data: string | Uint8Array): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;

  resolve(path: string): string;
  detectLanguage(path: string): string;

  tempDir: string;
}

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileStat {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  modifiedAt: Date;
  createdAt: Date;
}

// ===========================================
// LLM API
// ===========================================

export interface LlmApi {
  generateText(options: LlmTextOptions): Promise<string>;
  generateStructured<T = unknown>(options: LlmStructuredOptions): Promise<T>;
}

export interface LlmTextOptions {
  prompt: string;
  system?: string;
  model?: string;
  provider?: string;
  image?: LlmImage | LlmImage[];
  maxTokens?: number;
}

export interface LlmStructuredOptions extends Omit<LlmTextOptions, never> {
  prompt: string;
  system?: string;
  model?: string;
  provider?: string;
  image?: LlmImage | LlmImage[];
  maxTokens?: number;
  schema: Record<string, unknown>;
}

export interface LlmImage {
  data: Uint8Array | string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

// ===========================================
// Ask API (bidirectional tool ↔ client communication)
// ===========================================

// Who should handle this ask
export type AskTarget = 'human' | 'client' | 'permission';

// --- Human question types ---

export interface SingleSelectQuestion {
  type: 'single_select';
  question: string;
  description?: string;
  options: Array<{ label: string; value: string; description?: string }>;
}

export interface MultiSelectQuestion {
  type: 'multi_select';
  question: string;
  description?: string;
  options: Array<{ label: string; value: string; description?: string }>;
  min?: number;
  max?: number;
}

export interface TextQuestion {
  type: 'text';
  question: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface ConfirmQuestion {
  type: 'confirm';
  question: string;
  description?: string;
  defaultValue?: boolean;
}

export type HumanQuestion = SingleSelectQuestion | MultiSelectQuestion | TextQuestion | ConfirmQuestion;

// --- Form question (multiple sub-questions) ---

export interface FormQuestion {
  type: 'form';
  question: string;
  description?: string;
  questions: HumanQuestion[];
}

// --- Client capability ask ---

export interface ClientCapabilityAsk {
  type: 'client_capability';
  capability: string;
  metadata?: Record<string, unknown>;
}

// --- Union of all ask types ---
// PermissionAsk can be used directly (tools use canonical shape without target)
// or with target: 'permission' for explicit routing
export type Ask =
  | (HumanQuestion & { target: 'human' })
  | (FormQuestion & { target: 'human' })
  | (ClientCapabilityAsk & { target: 'client' })
  | (PermissionAsk & { target: 'permission' })
  | PermissionAsk;

// --- Typed Ask Responses (strongly typed for ask.response payload) ---

// Response for single_select: selected option value
export interface AskSingleSelectResponse {
  type: 'single_select';
  value: string;
}

// Response for multi_select: array of selected option values
export interface AskMultiSelectResponse {
  type: 'multi_select';
  values: string[];
}

// Response for text input
export interface AskTextResponse {
  type: 'text';
  value: string;
}

// Response for confirm (yes/no)
export interface AskConfirmResponse {
  type: 'confirm';
  confirmed: boolean;
}

// Response for form (answers to multiple sub-questions)
export interface AskFormResponse {
  type: 'form';
  answers: Array<{
    question: string;
    answer: string | boolean | string[];
  }>;
}

// Response for client capability ask (capability-specific response)
export interface AskClientCapabilityResponse {
  type: 'client_capability';
  capability: string;
  result: unknown;
}

// Union of all possible ask responses
export type AskResponse =
  | AskSingleSelectResponse
  | AskMultiSelectResponse
  | AskTextResponse
  | AskConfirmResponse
  | AskFormResponse
  | AskClientCapabilityResponse
  | AskPermissionResponse;

// --- AskApi overloaded callable ---

export type AskApi = {
  (request: SingleSelectQuestion & { target: 'human' }): Promise<AskSingleSelectResponse['value']>;
  (request: MultiSelectQuestion & { target: 'human' }): Promise<AskMultiSelectResponse['values']>;
  (request: TextQuestion & { target: 'human' }): Promise<AskTextResponse['value']>;
  (request: ConfirmQuestion & { target: 'human' }): Promise<AskConfirmResponse['confirmed']>;
  (request: FormQuestion & { target: 'human' }): Promise<AskFormResponse>;
  (request: ClientCapabilityAsk & { target: 'client' }): Promise<AskClientCapabilityResponse['result']>;
  (request: PermissionAsk & { target: 'permission' }): Promise<boolean>;
  (request: PermissionAsk): Promise<boolean>;
  (request: Ask): Promise<unknown>;
};

// ===========================================
// Env API
// ===========================================

export interface EnvApi {
  get(key: string): string | undefined;
  require(key: string): string;
}

// ===========================================
// Logger
// ===========================================

export interface ToolLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

// ===========================================
// Loaded Tool (server-side, after dynamic import)
// ===========================================

export interface LoadedTool {
  definition: ToolDefinition;
  execute: ToolModule['execute'];
  path: string;
}

// ===========================================
// Tool EnvVar Status
// ===========================================

export interface EnvVarLink {
  label: string;
  url: string;
}

export type EnvVarSource = 'preset' | 'tool' | 'custom';

export interface ToolEnvVarStatus {
  key: string;
  configured: boolean;
  sensitive: boolean;
  value?: string;
  description?: string;
  defaultValue?: string;
  example?: string;
  usedBy?: string[];
  source?: EnvVarSource;
  category?: string;
  link?: EnvVarLink;
}

// ===========================================
// Tool Execution (for persistence)
// ===========================================

export interface ToolExecution {
  id: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt: string;
  completedAt: string | null;
}

export type { InstallManifest } from './install-manifest';