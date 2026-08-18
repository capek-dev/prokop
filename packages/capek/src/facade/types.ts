import type { Part } from '@capekai/types';
import type { FacadeComposition } from '../plugins/compose';
import type { FacadeProfileId } from '../profiles/facade';
import type { ToolOutputArtifactPage } from '../storage/contracts';
export type { AgentStorageOption } from '../storage/options';

type ScopeDiagnosticsSnapshot = ReturnType<FacadeComposition['agentScope']['snapshot']>;

export type AgentInput = string | { text: string };

export interface RunOptions {
  signal?: AbortSignal;
  maxSteps?: number;
}

export type AgentPart = Part;

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
}

export interface AgentError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface AgentResult {
  status: 'completed' | 'failed' | 'interrupted';
  text: string;
  parts: AgentPart[];
  usage?: UsageSummary;
  structuredOutput?: unknown;
  error?: AgentError;
  sessionId: string;
}

export type AgentEvent =
  | { type: 'session.started'; sessionId: string }
  | { type: 'message'; sessionId: string; messageId: string; status: 'streaming' | 'completed' | 'failed' | 'interrupted' }
  | { type: 'part'; sessionId: string; part: AgentPart }
  | { type: 'part.append'; sessionId: string; partId: string; field: 'text' | 'reasoning'; delta: string }
  | { type: 'usage'; sessionId: string; usage: UsageSummary }
  | { type: 'retry'; sessionId: string; status: 'scheduled' | 'started' | 'cancelled' | 'exhausted'; retryNumber: number; maxRetries: number; message: string }
  | { type: 'compaction'; sessionId: string; status: 'started' | 'completed' | 'failed'; error?: AgentError }
  | { type: 'error'; sessionId: string; error: AgentError }
  | { type: 'result'; result: AgentResult };

export interface AgentDiagnostics {
  profileId: FacadeProfileId;
  process: ScopeDiagnosticsSnapshot;
  agent: ScopeDiagnosticsSnapshot;
}

export interface Agent {
  diagnostics(): Promise<AgentDiagnostics>;
  run(input: AgentInput, options?: RunOptions): Promise<AgentResult>;
  stream(input: AgentInput, options?: RunOptions): AsyncIterable<AgentEvent>;
  resume(sessionId: string, input?: AgentInput, options?: RunOptions): Promise<AgentResult>;
  retrieveToolOutput(
    sessionId: string,
    artifactId: string,
    options?: { offset?: number; limit?: number },
  ): Promise<ToolOutputArtifactPage | null>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}
