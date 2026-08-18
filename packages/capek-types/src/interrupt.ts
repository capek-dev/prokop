// The reason why an interrupt was triggered
export type InterruptReason = 'user_request' | 'timeout' | 'error' | 'cascade';

// State tracking for interrupts
export interface InterruptState {
  sessionId: string;
  interrupted: boolean;
  reason?: InterruptReason;
  interruptedAt?: number;
  interruptedBy?: string; // Session ID that initiated (for cascades)
}

// Result of an interrupt operation
export interface SessionInterruptResult {
  sessionId: string;
  success: boolean;
  cascadedTo: string[]; // Child session IDs that were also interrupted
  interruptedTools: string[]; // Tool call IDs that were interrupted
  rejectedAsks: string[]; // Ask IDs that were rejected (pending asks cleaned up)
  partialResults?: {
    toolCallId: string;
    partialOutput: unknown;
  }[];
}

// Context passed to tools for abort support
export interface ToolAbortContext {
  toolCallId: string;
  sessionId: string;
  signal?: AbortSignal;
}
