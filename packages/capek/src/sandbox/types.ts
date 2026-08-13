export interface SandboxCallMessage {
  role: string;
  content: unknown;
}

export interface SandboxToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface LlmCallContext {
  callId: string;
  sessionId: string;
  depth: number;
  mode: 'stream' | 'generate';
  messages: SandboxCallMessage[];
  systemPrompt?: string;
  tools: SandboxToolDefinition[];
  modelId: string;
  providerId: string;
  timestamp: number;
  parentCallId?: string;
}

export interface TextResponse {
  type: 'text';
  content: string;
}

export interface ToolCallResponse {
  type: 'tool-call';
  toolName: string;
  args: Record<string, unknown>;
  toolCallId?: string;
}

export interface MultiToolCallResponse {
  type: 'multi-tool-call';
  calls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    toolCallId?: string;
  }>;
}

export interface ErrorResponse {
  type: 'error';
  error: string;
  errorType?: 'rate_limit' | 'server' | 'timeout' | 'auth' | 'invalid_request';
}

export interface ReasoningResponse {
  type: 'reasoning';
  reasoning: string;
  text: string;
}

export type SandboxResponse =
  | TextResponse
  | ToolCallResponse
  | MultiToolCallResponse
  | ErrorResponse
  | ReasoningResponse;
