import { resolveToolSummary, type ToolPart } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { createPart, getToolPartByCallId, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updatePart } from '@/infrastructure/sqlite/message-store';
import { codexObject } from './app-server';
import { fileChangeVisualization } from './file-change-visualization';

const MAX_PREVIEW = 8_000;
const MAX_CHANGES = 50;
const DOMAIN_TOOLS = new Set(['memory', 'agent_memory', 'session_search', 'agent_skill_manage']);

function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}\n[truncated]` : text;
}

function dynamicContent(item: Record<string, unknown>): string | null {
  const items = Array.isArray(item.contentItems) ? item.contentItems
    : Array.isArray(item.result) ? item.result : null;
  if (!items) return null;
  const texts = items.map(codexObject).filter(entry => entry?.type === 'inputText'
    && typeof entry.text === 'string').map(entry => entry!.text as string);
  return texts.length ? texts.join('\n') : null;
}

function dynamicResult(item: Record<string, unknown>): Record<string, unknown> | null {
  const text = dynamicContent(item);
  try { return text ? codexObject(JSON.parse(text)) : null; } catch { return null; }
}

function memoryVisualization(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'dynamicToolCall' || item.namespace !== null
    || !['memory', 'agent_memory'].includes(String(item.tool))) return null;
  const result = dynamicResult(item);
  if (!result) return { type: 'none', message: preview(dynamicContent(item) ?? 'Memory result unavailable') };
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  const agent = item.tool === 'agent_memory';
  if (result.action === 'list') {
    const count = Array.isArray(result.entries) ? result.entries.length : 0;
    const usage = codexObject(result.usage);
    const chars = typeof usage?.chars === 'number' ? usage.chars : 0;
    const limit = typeof usage?.limit === 'number' ? usage.limit : 0;
    return { type: 'none', badge: `${count} entr${count === 1 ? 'y' : 'ies'}`
      + (!agent && usage ? ` · ${chars}/${limit} chars` : ''),
    message: `${agent ? 'Agent memory' : 'Memory'} (${result.target ?? 'memory'})` };
  }
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title)
    : agent ? 'Agent memory updated' : 'Memory updated' };
}

function sessionSearchVisualization(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'dynamicToolCall' || item.namespace !== null || item.tool !== 'session_search') return null;
  const result = dynamicResult(item);
  if (!result) return { type: 'none', message: preview(dynamicContent(item) ?? 'Session search result unavailable') };
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  const results = Array.isArray(result.results) ? result.results : null;
  const sessions = Array.isArray(result.sessions) ? result.sessions : null;
  if (results || sessions) {
    const entries = (results ?? sessions)!;
    const label = results ? 'result' : 'session';
    return { type: 'file-list', badge: `${entries.length} ${label}${entries.length === 1 ? '' : 's'}`,
      singularLabel: label, pluralLabel: `${label}s`,
      ...(results && { title: typeof result.query === 'string' ? preview(result.query)
        : typeof result.title === 'string' ? preview(result.title) : 'Search' }),
      files: entries.slice(0, 20).map(entry => {
        const row = codexObject(entry);
        const title = results ? row?.sessionTitle ?? row?.sessionId : row?.title ?? row?.id;
        return { path: preview(typeof title === 'string' ? title : '') };
      }), total: entries.length };
  }
  if (Array.isArray(result.messages)) return { type: 'none',
    badge: `${result.messages.length} message${result.messages.length === 1 ? '' : 's'}`,
    message: typeof result.sessionTitle === 'string' ? preview(result.sessionTitle) : 'Session context' };
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title) : 'Session search completed' };
}

function agentSkillVisualization(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'dynamicToolCall' || item.namespace !== null || item.tool !== 'agent_skill_manage') return null;
  const result = dynamicResult(item);
  if (!result) return { type: 'none', message: 'Agent skill result unavailable' };
  if (typeof result.error === 'string') return { type: 'none', message: preview(result.error) };
  if (result.action === 'list' && Array.isArray(result.skills)) {
    return { type: 'file-list', badge: `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}`,
      singularLabel: 'skill', pluralLabel: 'skills', title: 'Agent skills',
      files: result.skills.slice(0, 20).map(skill => {
        const entry = codexObject(skill);
        return { path: typeof entry?.name === 'string' ? preview(entry.name) : '',
          content: typeof entry?.description === 'string' ? preview(entry.description) : '' };
      }), total: result.skills.length };
  }
  return { type: 'none', message: typeof result.title === 'string' ? preview(result.title) : 'Agent skill updated' };
}

function collabAgentVisualization(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'collabAgentToolCall' && item.type !== 'subAgentActivity') return null;
  const action = typeof item.tool === 'string' ? item.tool : 'task';
  return { type: 'none', message: `Codex agent ${action} completed` };
}

function itemIdentity(item: Record<string, unknown>): { name: string; summary: string; input: Record<string, unknown> } | null {
  switch (item.type) {
    case 'commandExecution':
      if (typeof item.command !== 'string') return null;
      return { name: 'Codex command', summary: preview(item.command).slice(0, 500),
        input: { command: preview(item.command), cwd: typeof item.cwd === 'string' ? preview(item.cwd) : '' } };
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes.slice(0, MAX_CHANGES).map(codexObject).filter(Boolean) : [];
      const paths = changes.map(change => change?.path).filter((path): path is string => typeof path === 'string');
      return { name: 'Codex file change', summary: paths.length ? paths.map(path => preview(path).slice(0, 200)).join(', ').slice(0, 500) : 'Editing files',
        input: { paths, total: Array.isArray(item.changes) ? item.changes.length : 0 } };
    }
    case 'mcpToolCall':
      if (typeof item.server !== 'string' || typeof item.tool !== 'string') return null;
      return { name: 'Codex MCP', summary: `${item.server}: ${item.tool}`.slice(0, 500),
        input: { server: preview(item.server), tool: preview(item.tool), arguments: preview(item.arguments) } };
    case 'dynamicToolCall':
      if (typeof item.tool !== 'string') return null;
      if (item.namespace === null && DOMAIN_TOOLS.has(item.tool)) {
        const args = codexObject(item.arguments) ?? {};
        // Skill bodies stay in the Codex tool exchange, not the transcript or live part events.
        const input = item.tool === 'agent_skill_manage'
          ? { action: args.action, name: args.name } : args;
        return { name: item.tool, summary: resolveToolSummary(input,
          item.tool === 'session_search' ? '{action} {query}'
            : item.tool === 'agent_skill_manage' ? '{action} {name}' : '{action} {target}'), input };
      }
      return { name: 'Codex tool', summary: `${typeof item.namespace === 'string' ? `${item.namespace}: ` : ''}${item.tool}`.slice(0, 500),
        input: { tool: preview(item.tool), arguments: preview(item.arguments) } };
    case 'collabAgentToolCall':
      return { name: 'Codex agent', summary: typeof item.tool === 'string' ? item.tool : 'Agent task',
        input: { tool: item.tool, prompt: typeof item.prompt === 'string' ? preview(item.prompt) : undefined } };
    case 'subAgentActivity':
      if (item.kind !== 'started' || typeof item.agentThreadId !== 'string') return null;
      return { name: 'Codex agent', summary: typeof item.agentPath === 'string'
        ? item.agentPath.split('/').at(-1) ?? 'Agent task' : 'Agent task', input: { tool: 'spawnAgent' } };
    case 'webSearch':
      return { name: 'Codex web search', summary: 'Web search', input: {} };
    case 'imageView':
      return { name: 'Codex image view', summary: typeof item.path === 'string' ? preview(item.path).slice(0, 500) : 'Image', input: {} };
    case 'imageGeneration':
      return { name: 'Codex image generation', summary: 'Generate image', input: {} };
    default: {
      // Native Codex or user-provided integrations can add tool item kinds without a Prokop renderer.
      // Do not turn message, reasoning or control items into tool rows.
      if (typeof item.type !== 'string' || !item.type.trim()
        || typeof item.tool !== 'string' || !item.tool.trim()) return null;
      const label = typeof item.server === 'string' ? `${item.server}: ${item.tool}`
        : typeof item.namespace === 'string' ? `${item.namespace}: ${item.tool}` : item.tool;
      return { name: 'Codex tool', summary: label.slice(0, 500),
        input: { tool: preview(item.tool),
          ...(item.server !== undefined ? { server: preview(item.server) } : {}),
          ...(item.arguments !== undefined ? { arguments: preview(item.arguments) } : {}) } };
    }
  }
}

/** Projects app-server items into the existing transcript, never into Codex's approval policy. */
export class CodexToolItems {
  private readonly open = new Set<string>();

  constructor(
    private readonly sessionId: string,
    private readonly messageId: string,
    private readonly turnId: string,
    private readonly delivery: ApplicationDeliveryPort<unknown>,
    private readonly childSessionId?: (threadId: string) => string | null,
  ) {}

  private callId(item: Record<string, unknown>): string | null {
    return typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 256
      ? `codex-item:${this.turnId}:${item.id}` : null;
  }

  started(raw: unknown): void {
    const item = codexObject(raw);
    if (!item) return;
    const identity = itemIdentity(item);
    const callId = this.callId(item);
    if (!identity || !callId || getToolPartByCallId(this.sessionId, callId)) return;
    const threadId = item.type === 'subAgentActivity' ? item.agentThreadId
      : item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent'
        && Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length === 1
        ? item.receiverThreadIds[0] : null;
    const childSessionId = typeof threadId === 'string' ? this.childSessionId?.(threadId) : null;
    const part: ToolPart = { id: crypto.randomUUID(), messageId: this.messageId,
      createdAt: Date.now(), type: 'tool', callId, name: identity.name,
      state: { status: 'running', input: identity.input, startedAt: Date.now(),
        ...(childSessionId ? { childSessionId } : {}) },
      presentation: { summary: identity.summary, debugAvailable: false } };
    createPart(part, this.sessionId);
    this.open.add(part.id);
    this.delivery.broadcastToSession(this.sessionId, { type: 'part.created', sessionId: this.sessionId, part });
  }

  completed(raw: unknown): void {
    const item = codexObject(raw);
    if (!item || !itemIdentity(item) || !this.callId(item)) return;
    this.started(item); // A completed event may arrive without a started event.
    const part = getToolPartByCallId(this.sessionId, this.callId(item)!);
    if (!part || part.state.status !== 'running') return;
    const status = item.status;
    let updated: ToolPart | null;
    if (status === 'declined' || status === 'interrupted') {
      updated = transitionToolToInterrupted(part.id, 'user_request');
    } else if (status === 'failed' || status === 'error' || status === 'inProgress') {
      updated = transitionToolToError(part.id, 'Codex tool failed');
    } else {
      const content = item.type === 'commandExecution' ? preview(item.aggregatedOutput)
        : preview(item.type === 'dynamicToolCall'
          ? dynamicContent(item) ?? item.result ?? item.action ?? item.status ?? 'Completed'
          : item.result ?? item.contentItems ?? item.action ?? item.status ?? 'Completed');
      updated = transitionToolToCompleted(part.id, { status: typeof status === 'string' ? status : 'completed',
        ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {}),
        _visualization: item.type === 'commandExecution'
          ? { type: 'shell-output', command: preview(item.command), stdout: content,
            exitCode: typeof item.exitCode === 'number' ? item.exitCode : -1 }
          : item.type === 'fileChange' ? fileChangeVisualization(item.changes)
            : memoryVisualization(item) ?? sessionSearchVisualization(item)
              ?? agentSkillVisualization(item) ?? collabAgentVisualization(item)
              ?? { type: 'markdown', content } });
    }
    this.open.delete(part.id);
    if (updated) {
      const summary = itemIdentity(item)!.summary;
      const final = summary !== part.presentation?.summary
        ? updatePart(updated.id, { presentation: { summary, debugAvailable: false } }) as ToolPart | null
        : updated;
      if (final) this.delivery.broadcastToSession(this.sessionId, { type: 'part.updated', sessionId: this.sessionId, part: final });
    }
  }

  finish(): void {
    for (const id of this.open) {
      const updated = transitionToolToInterrupted(id, 'error');
      if (updated) this.delivery.broadcastToSession(this.sessionId, { type: 'part.updated', sessionId: this.sessionId, part: updated });
    }
    this.open.clear();
  }
}
