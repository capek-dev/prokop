export type {
  ErrorResponse,
  LlmCallContext,
  MultiToolCallResponse,
  ReasoningResponse,
  SandboxCallMessage,
  SandboxResponse,
  SandboxToolDefinition,
  TextResponse,
  ToolCallResponse,
} from '@capekai/core/compat/jean2';

import type {
  LlmCallContext,
  SandboxResponse,
} from '@capekai/core/compat/jean2';

export interface AutoResponderRule {
  match: {
    mode?: 'stream' | 'generate';
    depth?: number | number[];
    sessionId?: string | string[];
    hasToolResults?: boolean;
  };
  response: SandboxResponse;
  maxUses?: number;
  label?: string;
}

export interface SandboxHistoryEntry {
  callId: string;
  context: LlmCallContext;
  response: SandboxResponse | null;
  respondedAt: number | null;
  completedAt: number | null;
}

export interface SandboxCallWaitingEvent {
  type: 'sandbox.call_waiting';
  context: LlmCallContext;
}

export interface SandboxRespondMessage {
  type: 'sandbox.respond';
  callId: string;
  response: SandboxResponse;
}

export interface SandboxCallCompletedEvent {
  type: 'sandbox.call_completed';
  callId: string;
}

export interface SandboxHistoryEvent {
  type: 'sandbox.history';
  entries: SandboxHistoryEntry[];
}

export type SandboxControlEvent =
  | SandboxCallWaitingEvent
  | SandboxCallCompletedEvent
  | SandboxHistoryEvent;
