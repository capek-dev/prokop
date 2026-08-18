import type { Tool } from 'ai';
import type { AskBroadcastFn } from '../../permission/ask-user-api';

export interface ToolBuildContext {
  sessionId: string;
  workspaceId: string | undefined;
  workspacePath: string | undefined;
  rootSessionId: string;
  modelId?: string;
  providerId?: string;
  broadcastFn?: AskBroadcastFn;
  additionalPaths?: string[];
  agentId?: string | null;
}

export type ToolMap = Record<string, Tool>;
