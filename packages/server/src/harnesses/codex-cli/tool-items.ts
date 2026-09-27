import type { ToolPart } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { createPart, getToolPartByCallId, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updatePart } from '@/infrastructure/sqlite/message-store';
import { codexObject } from './app-server';
import { fileChangeVisualization } from './file-change-visualization';

const MAX_PREVIEW = 8_000;
const MAX_CHANGES = 50;

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

function memoryVisualization(item: Record<string, unknown>): Record<string, unknown> | null {
  if (item.type !== 'dynamicToolCall' || !['memory', 'agent_memory'].includes(String(item.tool))) return null;
  const text = dynamicContent(item);
  if (!text) return { type: 'none', message: 'Memory updated' };
  let result: Record<string, unknown> | null;
  try { result = codexObject(JSON.parse(text)); } catch { result = null; }
  if (!result) return { type: 'none', message: 'Memory result unavailable' };
  if (Array.isArray(result.entries) && result.entries.every(entry => typeof entry === 'string')) {
    const entries = result.entries as string[];
    return { type: 'code', path: result.target === 'user' ? 'USER.md' : 'MEMORY.md',
      content: preview(entries.join('\n')), created: false, collapsed: true,
      badge: `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` };
  }
  return { type: 'none', message: typeof result.error === 'string' ? preview(result.error)
    : typeof result.action === 'string' ? `Memory ${result.action} complete` : 'Memory updated' };
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
      return { name: 'Codex tool', summary: `${typeof item.namespace === 'string' ? `${item.namespace}: ` : ''}${item.tool}`.slice(0, 500),
        input: { tool: preview(item.tool), arguments: preview(item.arguments) } };
    case 'collabAgentToolCall':
      return { name: 'Codex agent', summary: typeof item.tool === 'string' ? item.tool : 'Agent task',
        input: { tool: item.tool, prompt: typeof item.prompt === 'string' ? preview(item.prompt) : undefined } };
    case 'webSearch':
      return { name: 'Codex web search', summary: 'Web search', input: {} };
    case 'imageView':
      return { name: 'Codex image view', summary: typeof item.path === 'string' ? preview(item.path).slice(0, 500) : 'Image', input: {} };
    case 'imageGeneration':
      return { name: 'Codex image generation', summary: 'Generate image', input: {} };
    default:
      return null;
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
    const part: ToolPart = { id: crypto.randomUUID(), messageId: this.messageId,
      createdAt: Date.now(), type: 'tool', callId, name: identity.name,
      state: { status: 'running', input: identity.input, startedAt: Date.now() },
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
            : memoryVisualization(item) ?? { type: 'markdown', content } });
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
