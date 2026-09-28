import {
  resolveToolSummary,
  type AnyVisualization,
  type MessageWithParts,
  type ToolPart,
  type ToolState,
} from '@prokopai/sdk';
import type { ToolCatalogPort } from '../ports/tool-catalog';

export interface ToolDebugData {
  input: Record<string, unknown>;
  output?: unknown;
}

function extractVisualization(output: unknown): AnyVisualization | undefined {
  if (!output || typeof output !== 'object' || !('_visualization' in output)) {
    return undefined;
  }
  const visualization = (output as Record<string, unknown>)._visualization;
  return visualization && typeof visualization === 'object'
    ? visualization as AnyVisualization
    : undefined;
}

function extractChildSessionId(part: ToolPart): string | undefined {
  if ('childSessionId' in part.state && part.state.childSessionId) {
    return part.state.childSessionId;
  }
  if (part.name !== 'task' || part.state.status !== 'completed') return undefined;
  if (typeof part.state.output !== 'string') return undefined;
  return part.state.output.match(/task_id:\s*([a-f0-9-]{36})/i)?.[1];
}

function projectState(part: ToolPart, visualization?: AnyVisualization): ToolState {
  const state = part.state;
  const childSessionId = extractChildSessionId(part);

  switch (state.status) {
    case 'pending':
      return { status: 'pending', input: {} };
    case 'running':
      return {
        status: 'running',
        input: {},
        startedAt: state.startedAt,
        ...(childSessionId && { childSessionId }),
      };
    case 'completed':
      return {
        status: 'completed',
        input: {},
        output: visualization ? { _visualization: visualization } : null,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        ...(state.compactedAt !== undefined && { compactedAt: state.compactedAt }),
        ...(childSessionId && { childSessionId }),
      };
    case 'error':
      return {
        status: 'error',
        input: {},
        error: state.error,
        startedAt: state.startedAt,
        failedAt: state.failedAt,
        ...(childSessionId && { childSessionId }),
      };
    case 'interrupted':
      return {
        status: 'interrupted',
        input: {},
        startedAt: state.startedAt,
        interruptedAt: state.interruptedAt,
        reason: state.reason,
        ...(childSessionId && { childSessionId }),
      };
  }
}

const summaryTemplateCache = new WeakMap<
  object,
  { expiresAt: number; value: Promise<Map<string, string>> }
>();

async function getSummaryTemplates(
  catalog?: Pick<ToolCatalogPort, 'listTools'>,
): Promise<Map<string, string>> {
  if (!catalog) return new Map();
  const cached = summaryTemplateCache.get(catalog);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const value = catalog.listTools()
    .then((tools) => new Map(
      tools.flatMap((tool) => tool.display?.summary
        ? [[tool.name, tool.display.summary] as const]
        : []),
    ))
    .catch(() => new Map<string, string>());
  summaryTemplateCache.set(catalog, {
    expiresAt: Date.now() + 5 * 60 * 1000,
    value,
  });
  return value;
}

export async function projectMessagesForClient(
  messages: MessageWithParts[],
  catalog?: Pick<ToolCatalogPort, 'listTools'>,
): Promise<MessageWithParts[]> {
  const templates = await getSummaryTemplates(catalog);
  return messages.map(({ message, parts }) => ({
    message,
    parts: parts.map((part) => {
      if (part.type !== 'tool') return part;
      const storedVisualization = part.state.status === 'completed'
        ? extractVisualization(part.state.output)
        : undefined;
      // Old webfetch rows stored the entire fetched page as a Markdown preview.
      // Preserve the original output for on-demand debug, but do not re-embed it.
      const visualization = part.name === 'webfetch' && storedVisualization?.type === 'markdown'
        ? { type: 'none' as const, badge: storedVisualization.badge,
          message: 'Fetched page (open raw data to inspect)' }
        : part.callId.startsWith('codex-item:') && part.name === 'Codex tool'
          && part.state.input.tool === 'agent_skill_manage' && storedVisualization?.type === 'markdown'
          ? { type: 'none' as const, message: 'Agent skill operation completed' }
          : part.callId.startsWith('codex-item:') && part.name === 'Codex agent'
            && storedVisualization?.type === 'markdown'
            ? { type: 'none' as const, message: 'Codex agent task completed' }
            : storedVisualization;
      return {
        ...part,
        state: projectState(part, visualization),
        presentation: {
          summary: part.callId.startsWith('codex-item:') && part.name === 'Codex agent'
            ? part.presentation?.summary ?? 'Agent task'
            : part.callId.startsWith('codex-item:') && part.name === 'Codex tool'
            && part.state.input.tool === 'agent_skill_manage' ? 'agent_skill_manage'
            : part.name === 'agent_skill_manage' && !templates.has(part.name)
              ? part.presentation?.summary ?? 'Agent skill management'
              : part.callId.startsWith('codex-item:') && part.name === 'Codex tool'
                ? part.presentation?.summary ?? resolveToolSummary(part.state.input, templates.get(part.name))
                : resolveToolSummary(part.state.input, templates.get(part.name)),
          ...(visualization && { visualization }),
          debugAvailable: true,
        },
      } satisfies ToolPart;
    }),
  }));
}

export function getToolDebugData(part: ToolPart): ToolDebugData {
  return {
    input: part.state.input,
    ...(part.state.status === 'completed' && { output: part.state.output }),
  };
}
