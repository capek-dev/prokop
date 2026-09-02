import type { SessionExecutionPort } from '../ports/execution';
import type { ControllerGatePort, SessionControlPort } from '../ports/control';
import type { AskAuthorityPort, PendingAskPort, SessionRepositoryPort } from '../ports/session';
import type { ToolCatalogPort } from '../ports/tool-catalog';
import {
  createSessionChatApplication,
  type SessionChatApplication,
} from './chat';
import {
  createSessionLifecycleApplication,
  type SessionCreateInput,
  type SessionLifecycleApplication,
} from './lifecycle';
import {
  createSessionTranscriptApplication,
  type SessionTranscriptApplication,
} from './transcript';
import {
  createSessionQueueApplication,
  type SessionQueueApplication,
} from './queue';
import { createSessionHttpApplication, type SessionHttpApplication } from './http';

export interface SessionApplicationDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
  control: SessionControlPort<Origin>;
  pendingAsks: PendingAskPort;
  askAuthority: AskAuthorityPort;
  toolCatalog?: Pick<ToolCatalogPort, 'listTools'>;
}

/**
 * WebSocket-facing session application: chat, lifecycle, transcript, and
 * queue use cases over injected ports. Delivery and origin bookkeeping are
 * supplied per message through the wire ports.
 */
export interface SessionApplication<Origin> {
  chat: SessionChatApplication<Origin>;
  lifecycle: SessionLifecycleApplication<Origin>;
  transcript: SessionTranscriptApplication<Origin>;
  queue: SessionQueueApplication<Origin>;
}

export function createSessionApplication<Origin>(
  deps: SessionApplicationDeps<Origin>,
): SessionApplication<Origin> {
  return {
    chat: createSessionChatApplication(deps),
    lifecycle: createSessionLifecycleApplication(deps),
    transcript: createSessionTranscriptApplication(deps),
    queue: createSessionQueueApplication(deps),
  };
}

export {
  createSessionHttpApplication,
  createSessionQueueApplication,
  createSessionTranscriptApplication,
  type SessionChatApplication,
  type SessionCreateInput,
  type SessionHttpApplication,
  type SessionLifecycleApplication,
  type SessionQueueApplication,
  type SessionTranscriptApplication,
};

export type { SessionWirePorts } from '../ports/delivery';
