export interface SelectedContextItem {
  id: string;
  kind: 'memory' | 'skill' | 'preferences';
  source: 'agent' | 'workspace';
  name: string;
  description?: string;
  revision: string;
  content: string;
  inclusion: 'selected' | 'preloaded' | 'always' | 'baseline';
  score?: number;
}

/** Immutable assembly record. It does not assert provider delivery or compliance. */
export interface SelectedContextRecord {
  sessionId: string;
  assistantMessageId: string;
  requestMessageId?: string;
  checkpointMessageId?: string;
  continuation: boolean;
  createdAt: string;
  outcome: 'selected' | 'disabled' | 'missing_credentials' | 'missing_evidence' | 'timeout' | 'failed' | 'input_limit';
  threshold: number;
  elapsedMs: number;
  items: SelectedContextItem[];
  excluded: Array<{ id: string; name: string; source: 'agent' | 'workspace'; score: number; reason: 'threshold' | 'budget' }>;
}
