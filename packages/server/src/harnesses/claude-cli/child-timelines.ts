import type { AssistantMessage, Session, TextPart, ToolPart } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart, getToolPartByCallId, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import type { ClaudeTurnEvent } from './sdk-turn';

interface Child {
  sessionId: string;
  assistant: AssistantMessage;
  text: string;
  part: TextPart | null;
  openTools: Set<string>;
  status: 'running' | 'completed' | 'error' | 'interrupted';
}

const MAX_CHILDREN = 32;
const MAX_CHILD_TEXT = 100_000;

/** Child ownership is the Agent tool-use ID, not the SDK session ID shared with its parent. */
export class ClaudeChildTimelines {
  private readonly children = new Map<string, Child>();
  private readonly early = new Map<string, ClaudeTurnEvent[]>();

  constructor(private readonly parent: Session, private readonly nativeId: string,
    private readonly delivery: ApplicationDeliveryPort<unknown>) {}

  start(id: string, owner?: string): string | null {
    if (!id || id.length > 256 || this.children.has(id) || this.children.size >= MAX_CHILDREN) return null;
    const parentId = owner ? this.children.get(owner)?.sessionId : this.parent.id;
    if (!parentId) return null;
    const session = createSession({ id: crypto.randomUUID(), workspaceId: this.parent.workspaceId,
      workspaceRootId: this.parent.workspaceRootId, harness: 'claude-cli', parentId,
      preconfigId: this.parent.preconfigId, agentId: this.parent.agentId,
      selectedModel: this.parent.selectedModel, selectedProvider: this.parent.selectedProvider,
      permissionMode: this.parent.permissionMode, title: 'Claude agent (subagent)',
      status: 'active', metadata: null, agentName: 'Claude agent', subagentStatus: 'running' });
    const assistant = createMessage({ id: crypto.randomUUID(), sessionId: session.id, role: 'assistant',
      status: 'streaming', providerId: 'claude-cli', modelId: this.parent.selectedModel ?? 'claude-cli',
      tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() }) as AssistantMessage;
    this.children.set(id, { sessionId: session.id, assistant, text: '', part: null,
      openTools: new Set(), status: 'running' });
    if (owner) this.owners.set(id, owner);
    this.delivery.broadcast({ type: 'session.created', session });
    this.delivery.broadcastToSession(session.id, { type: 'message.created', message: assistant });
    const buffered = this.early.get(id) ?? [];
    this.early.delete(id);
    for (const event of buffered) this.receive(event);
    return session.id;
  }

  childSessionId(agentToolId: string): string | null {
    return this.children.get(agentToolId)?.sessionId ?? null;
  }

  receive(event: ClaudeTurnEvent): void {
    const owner = event.parentToolUseId;
    if (!owner || event.type === 'result') return;
    const child = this.children.get(owner);
    if (!child) {
      const buffer = this.early.get(owner) ?? [];
      if ((this.early.size < 16 || this.early.has(owner)) && buffer.length < 16
        && JSON.stringify(event).length < 16_384) {
        buffer.push(event);
        this.early.set(owner, buffer);
      }
      return;
    }
    if (child.status !== 'running') return;
    const { sessionId, assistant } = child;
    if (event.type === 'text-delta' || event.type === 'text-final') {
      if (event.type === 'text-final' && event.streamed && !child.text.endsWith(event.streamed)) {
        throw new Error('Claude child text stream changed');
      }
      const next = event.type === 'text-delta' ? child.text + event.text
        : child.text.slice(0, child.text.length - event.streamed.length) + event.text;
      if (next.length > MAX_CHILD_TEXT) throw new Error('Claude child transcript exceeds limit');
      if (!child.part) {
        child.part = createPart({ id: crypto.randomUUID(), messageId: assistant.id,
          type: 'text', text: event.type === 'text-delta' ? '' : next, createdAt: Date.now() }, sessionId) as TextPart;
        this.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: child.part });
      }
      if (event.type === 'text-delta') {
        updatePart(child.part.id, { text: next });
        this.delivery.broadcastToSession(sessionId, { type: 'part.append', sessionId,
          partId: child.part.id, field: 'text', delta: event.text });
      } else if (child.part.text !== next) {
        const updated = updatePart(child.part.id, { text: next });
        if (updated) this.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
      }
      child.part = { ...child.part, text: next };
      child.text = next;
    } else if (event.type === 'tool-start') {
      const callId = `claude-tool:${this.nativeId}:${event.id}`;
      if (getToolPartByCallId(sessionId, callId)) throw new Error('Duplicate Claude child tool identity');
      const input = Object.fromEntries(Object.entries(event.input).slice(0, 16).map(([key, value]) => [key.slice(0, 80),
        typeof value === 'string' ? value.slice(0, 1000) : typeof value === 'number' || typeof value === 'boolean' ? value : '[omitted]']));
      const nestedId = event.name === 'Agent' ? this.start(event.id, owner) : null;
      const part: ToolPart = { id: crypto.randomUUID(), messageId: assistant.id, type: 'tool', callId,
        name: event.name === 'Agent' ? 'Claude Agent' : `Claude ${event.name}`, createdAt: Date.now(),
        state: { status: 'running', input, startedAt: Date.now(), ...(nestedId ? { childSessionId: nestedId } : {}) },
        presentation: { summary: typeof input.command === 'string' ? input.command.slice(0, 200)
          : typeof input.file_path === 'string' ? input.file_path.slice(0, 200) : event.name, debugAvailable: false } };
      createPart(part, sessionId);
      child.openTools.add(part.id);
      this.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
    } else if (event.type === 'tool-end') {
      const part = getToolPartByCallId(sessionId, `claude-tool:${this.nativeId}:${event.id}`);
      if (!part || !child.openTools.delete(part.id)) throw new Error('Unknown Claude child tool result');
      if (this.children.has(event.id)) this.finish(event.id, event.failed ? 'error' : 'completed');
      const updated = event.failed ? transitionToolToError(part.id, 'Claude tool failed')
        : transitionToolToCompleted(part.id, { _visualization: { type: 'none', message: 'Claude tool completed' },
          preview: event.output });
      if (updated) this.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
    }
  }

  finish(id: string, status: 'completed' | 'error' | 'interrupted'): void {
    const child = this.children.get(id);
    if (!child || child.status !== 'running') return;
    child.status = status;
    for (const partId of child.openTools) {
      const part = transitionToolToInterrupted(partId, 'error');
      if (part) this.delivery.broadcastToSession(child.sessionId,
        { type: 'part.updated', sessionId: child.sessionId, part });
    }
    child.openTools.clear();
    const message = updateMessage(child.assistant.id, { status, completedAt: Date.now() });
    if (message) this.delivery.broadcastToSession(child.sessionId, { type: 'message.updated', message });
    const session = updateSession(child.sessionId, { subagentStatus: status });
    if (session) this.delivery.broadcast({ type: 'session.updated', session });
    for (const [nestedId, nested] of this.children) {
      if (nested.sessionId !== child.sessionId && nested.status === 'running'
        && this.parentOf(nestedId) === id) this.finish(nestedId, status === 'completed' ? 'interrupted' : status);
    }
  }

  private readonly owners = new Map<string, string>();
  private parentOf(id: string): string | undefined { return this.owners.get(id); }

  close(status: 'error' | 'interrupted'): void {
    for (const id of this.children.keys()) this.finish(id, status);
    this.early.clear();
  }
}
