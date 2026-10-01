import type { SessionExecutionPort } from '@/application/ports/execution';
import type { ControllerGatePort, SessionControlPort } from '@/application/ports/control';
import type { AskAuthorityPort, PendingAskPort, SessionRepositoryPort } from '@/application/ports/session';
import type { ToolCatalogPort } from '@/application/ports/tool-catalog';
import type { WorktreeAttachmentRefreshPort } from '@/application/ports/worktree';
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
import { createSessionTitleRegeneration } from './title';

export interface SessionApplicationDeps<Origin> {
  repository: SessionRepositoryPort;
  execution: SessionExecutionPort;
  gate: ControllerGatePort<Origin>;
  control: SessionControlPort<Origin>;
  pendingAsks: PendingAskPort;
  askAuthority: AskAuthorityPort;
  toolCatalog?: Pick<ToolCatalogPort, 'listTools'>;
  workspaceRoots?: {
    isAvailable(workspaceId: string, workspaceRootId: string): boolean;
  };
  worktreeAttachments?: WorktreeAttachmentRefreshPort;
  codexAvailable?: () => boolean;
  codexWorkspaceAvailable?: (workspaceId: string) => boolean;
  codexModels?: () => Promise<import('@prokopai/sdk').CodexModel[]>;
  claudeAvailable?: () => boolean;
  claudeWorkspaceAvailable?: (workspaceId: string) => boolean;
  claudeModels?: () => Promise<import('@prokopai/sdk').CodexModel[]>;
  prokopModelAvailable?: (modelId: string, providerId: string) => boolean;
  isHarnessDisabled?: (harness: import('@prokopai/sdk').SessionHarness) => boolean;
  selectEmptySessionHarnessModel?: (id: string, expected: import('@prokopai/sdk').SessionHarness, updatedAt: string,
    choice: import('@prokopai/sdk').HarnessModelChoice) => import('@prokopai/sdk').Session | null;
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
  createSessionTitleRegeneration,
  createSessionTranscriptApplication,
  type SessionChatApplication,
  type SessionCreateInput,
  type SessionHttpApplication,
  type SessionLifecycleApplication,
  type SessionQueueApplication,
  type SessionTranscriptApplication,
};

export type { SessionWirePorts } from '@/application/ports/delivery';
