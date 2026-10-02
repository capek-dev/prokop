import type { PreconfigCapabilities, PreconfigMode } from './preconfig';

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  provider: string | null;
  variant?: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: PreconfigMode;
  canSpawnSubagents?: boolean | string[] | null;
  skills?: string[] | null;
  /** Agent-level capability switches. Absent or null means all enabled. */
  capabilities?: PreconfigCapabilities | null;
  hasHome: boolean;
  createdAt: string;
}

/** Read-only skill summary from the agent's personal skills directory. */
export interface AgentSkillSummary {
  name: string;
  description: string;
}

/** Agent learning config stored in the preconfig `settings.learning` bag.
 * Absent or null means enabled with defaults: agents learn out of the box. */
export interface AgentLearningConfig {
  enabled: boolean;
  cadence: {
    idleMinutes: number;
    minimumIntervalMinutes: number;
    maximumPendingMinutes: number;
  } | null;
  instructions: string;
  sources:
    | { mode: 'all' }
    | { mode: 'selected'; workspaceIds: string[] };
}

/** Parse the agent learning config out of a preconfig settings bag.
 * Absent or null returns the enabled defaults; a malformed value returns
 * null (fail closed, mirroring the server parser). */
export function parseAgentLearningSettings(
  settings: Record<string, unknown> | null | undefined,
): AgentLearningConfig | null {
  const raw = settings?.learning;
  if (raw === undefined || raw === null) {
    return { enabled: true, cadence: null, instructions: '', sources: { mode: 'all' } };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as Partial<AgentLearningConfig> & { sources?: { mode?: unknown; workspaceIds?: unknown } };
  if (typeof candidate.enabled !== 'boolean') return null;
  if (candidate.cadence !== null && candidate.cadence !== undefined) {
    const cadence = candidate.cadence;
    if (typeof cadence.idleMinutes !== 'number'
      || typeof cadence.minimumIntervalMinutes !== 'number'
      || typeof cadence.maximumPendingMinutes !== 'number') return null;
  }
  if (typeof candidate.instructions !== 'string') return null;
  const sources = candidate.sources;
  if (!sources || typeof sources !== 'object') return null;
  if (sources.mode === 'all') {
    if (sources.workspaceIds !== undefined) return null;
  } else if (sources.mode === 'selected') {
    if (!Array.isArray(sources.workspaceIds)
      || !sources.workspaceIds.every(id => typeof id === 'string')) return null;
  } else {
    return null;
  }
  return {
    enabled: candidate.enabled,
    cadence: candidate.cadence ?? null,
    instructions: candidate.instructions,
    sources: sources as AgentLearningConfig['sources'],
  };
}
