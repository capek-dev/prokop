// ===========================================
// Tool State Types
// ===========================================

export type ToolStatus = 'pending' | 'running' | 'completed' | 'error' | 'interrupted';

interface ToolStateBase {
  input: Record<string, unknown>;
}

export interface ToolStatePending extends ToolStateBase {
  status: 'pending';
}

export interface ToolStateRunning extends ToolStateBase {
  status: 'running';
  startedAt: number; // Unix timestamp in ms
  childSessionId?: string; // For 'task' tool: ID of the child/subagent session
}

export interface ToolStateCompleted extends ToolStateBase {
  status: 'completed';
  output: unknown;
  startedAt: number;
  completedAt: number;
  compactedAt?: number; // When this tool's results were compacted into a summary
  childSessionId?: string; // For 'task' tool: ID of the child/subagent session
}

export interface ToolStateError extends ToolStateBase {
  status: 'error';
  error: string;
  startedAt: number;
  failedAt: number;
}

export interface ToolStateInterrupted extends ToolStateBase {
  status: 'interrupted';
  input: Record<string, unknown>;
  startedAt: number;
  interruptedAt: number;
  reason: 'user_request' | 'timeout' | 'error' | 'cascade';
  partialOutput?: unknown; // Save partial results for potential resumption
  childSessionId?: string; // For 'task' tool: ID of the child/subagent session
}

export type ToolState =
  | ToolStatePending
  | ToolStateRunning
  | ToolStateCompleted
  | ToolStateError
  | ToolStateInterrupted;

// ===========================================
// Part Types
// ===========================================

interface PartBase {
  id: string;
  messageId: string;
  createdAt: number; // Unix timestamp in ms
}

export interface TextPart extends PartBase {
  type: 'text';
  text: string;
}

export interface ReasoningPart extends PartBase {
  type: 'reasoning';
  text: string;
}

export interface ToolPart extends PartBase {
  type: 'tool';
  callId: string; // Maps to AI SDK's toolCallId
  name: string; // Tool name (e.g., 'bash', 'read', 'write')
  state: ToolState;
}

export interface FilePart extends PartBase {
  type: 'file';
  mimeType: string;
  filename?: string;
  url: string; // Data URL or file path
}

export interface ImagePart extends PartBase {
  type: 'image';
  url: string;
  mimeType?: string;
}

export interface StepPart extends PartBase {
  type: 'step';
  number: number;
  status: 'started' | 'finished';
  // Only populated when status === 'finished':
  finishReason?: 'stop' | 'tool-calls' | 'error' | 'length';
  tokens?: {
    prompt: number;
    completion: number;
    cacheRead?: number;
    cacheWrite?: number;
    noCache?: number;
  };
  cost?: number;
}

export interface CompactionPart extends PartBase {
  type: 'compaction';
  auto: boolean; // true if triggered automatically, false if manual
  overflow?: boolean; // true if triggered due to context overflow
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolPart
  | FilePart
  | ImagePart
  | StepPart
  | CompactionPart;

// ===========================================
// Message Types
// ===========================================

export type MessageRole = 'user' | 'assistant' | 'system';
export type AssistantStatus = 'streaming' | 'completed' | 'error' | 'interrupted';

interface MessageBase {
  id: string;
  sessionId: string;
  role: MessageRole;
  createdAt: number; // Unix timestamp in ms
}

export interface UserMessage extends MessageBase {
  role: 'user';
}

export interface SystemMessage extends MessageBase {
  role: 'system';
}

export interface StructuredOutputData {
  formatName?: string;
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export interface AssistantMessage extends MessageBase {
  role: 'assistant';
  status: AssistantStatus;
  modelId: string;
  providerId: string;
  agent?: string;
  tokens: {
    prompt: number;
    completion: number;
    cacheRead?: number;
    cacheWrite?: number;
    noCache?: number;
  };
  cost: number;
  completedAt?: number;
  error?: string;
  // Compaction-related metadata
  summary?: boolean; // true if this message contains a compaction summary
  mode?: 'chat' | 'compaction' | 'compact_failed' | 'retry_failed';
  parentId?: string; // Parent message ID for task lineage (links summary to compacted messages)
  // Structured output metadata (when response format was used)
  structuredOutput?: StructuredOutputData;
}

export type Message = UserMessage | AssistantMessage | SystemMessage;

// ===========================================
// Pinned Message Types
// ===========================================

export interface PinnedMessage {
  id: string;
  workspaceId: string;
  sessionId: string;
  messageId: string;
  createdAt: number;
  sessionTitle: string | null;
  messageCreatedAt: number;
  preview: string;
}

// ===========================================
// Combined Types
// ===========================================

export interface MessageWithParts {
  message: Message;
  parts: Part[];
}

export interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  position: number;
  createdAt: number;
  attachments?: Array<{ id: string; kind: string; filename?: string; mimeType?: string; accessKey?: string }>;
}

// ===========================================
// WebSocket Event Types
// ===========================================

export type PartField = 'text' | 'reasoning';

export type MessageEvent =
  // Message lifecycle
  | { type: 'message.created'; message: Message }
  | { type: 'message.updated'; message: Message }
  // Part lifecycle
  | { type: 'part.created'; sessionId: string; part: Part }
  | { type: 'part.updated'; sessionId: string; part: Part }
  | { type: 'part.append'; sessionId: string; partId: string; field: PartField; delta: string };

// ===========================================
// Type Guards
// ===========================================

export function isTextPart(part: Part): part is TextPart {
  return part.type === 'text';
}

export function isToolPart(part: Part): part is ToolPart {
  return part.type === 'tool';
}

export function isReasoningPart(part: Part): part is ReasoningPart {
  return part.type === 'reasoning';
}

export function isStepPart(part: Part): part is StepPart {
  return part.type === 'step';
}

export function isImagePart(part: Part): part is ImagePart {
  return part.type === 'image';
}

export function isFilePart(part: Part): part is FilePart {
  return part.type === 'file';
}

export function isCompactionPart(part: Part): part is CompactionPart {
  return part.type === 'compaction';
}

export function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === 'assistant';
}

export function isUserMessage(message: Message): message is UserMessage {
  return message.role === 'user';
}
