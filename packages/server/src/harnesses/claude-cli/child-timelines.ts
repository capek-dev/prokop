import type { AssistantMessage, Session, TextPart, ToolPart } from '@prokopai/sdk';
import type { ApplicationDeliveryPort } from '@/application/ports/delivery';
import { createSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { createMessage, createPart, getToolPartByCallId, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import type { ClaudeTurnEvent } from './sdk-turn';
import { claudeToolInput, claudeToolName, claudeToolSummary, claudeToolVisualization } from '@/harnesses/shared/tool-viz';

interface ChildTextSegment { part: TextPart; text: string }

interface Child {
  sessionId: string;
  assistant: AssistantMessage;
  // Text interleaves with tool calls: a tool-start closes the open segment
  // so following text lands in a new part after the tool row.
  segments: ChildTextSegment[];
  openSegment: ChildTextSegment | null;
  textLength: number;
  // Parts sort by created_at; a monotonic clock keeps the order stable
  // within the same millisecond.
  partClock: number;
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
      agent: this.parent.agentId ?? undefined,
      tokens: { prompt: 0, completion: 0 }, cost: 0, createdAt: Date.now() }) as AssistantMessage;
    this.children.set(id, { sessionId: session.id, assistant, segments: [], openSegment: null,
      textLength: 0, partClock: 0, openTools: new Set(), status: 'running' });
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
      if (event.type === 'text-final' && event.streamed
        && !(child.openSegment?.text ?? '').endsWith(event.streamed)) {
        throw new Error('Claude child text stream changed');
      }
      const current = child.openSegment?.text ?? '';
      const delta = event.type === 'text-delta' ? event.text : undefined;
      const streamed = event.type === 'text-final' ? event.streamed : '';
      const next = event.type === 'text-delta' ? current + event.text
        : current.slice(0, current.length - streamed.length) + event.text;
      if (child.textLength - current.length + next.length > MAX_CHILD_TEXT) {
        throw new Error('Claude child transcript exceeds limit');
      }
      if (!child.openSegment) {
        child.partClock = Math.max(Date.now(), child.partClock + 1);
        const part = createPart({ id: crypto.randomUUID(), messageId: assistant.id,
          type: 'text', text: delta === undefined ? next : '', createdAt: child.partClock }, sessionId) as TextPart;
        this.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
        child.openSegment = { part, text: delta === undefined ? next : '' };
        child.segments.push(child.openSegment);
      }
      if (delta !== undefined) {
        updatePart(child.openSegment.part.id, { text: next });
        this.delivery.broadcastToSession(sessionId, { type: 'part.append', sessionId,
          partId: child.openSegment.part.id, field: 'text', delta });
      } else if (child.openSegment.part.text !== next) {
        const updated = updatePart(child.openSegment.part.id, { text: next });
        if (updated) this.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
      }
      child.textLength = child.textLength - current.length + next.length;
      child.openSegment = { part: { ...child.openSegment.part, text: next }, text: next };
    } else if (event.type === 'tool-start') {
      child.openSegment = null;
      const callId = `claude-tool:${this.nativeId}:${event.id}`;
      if (getToolPartByCallId(sessionId, callId)) throw new Error('Duplicate Claude child tool identity');
      const input = claudeToolInput(event.input);
      const nestedId = event.name === 'Agent' ? this.start(event.id, owner) : null;
      const name = claudeToolName(event.name);
      const part: ToolPart = { id: crypto.randomUUID(), messageId: assistant.id, type: 'tool', callId,
        name, createdAt: (child.partClock = Math.max(Date.now(), child.partClock + 1)),
        state: { status: 'running', input, startedAt: Date.now(), ...(nestedId ? { childSessionId: nestedId } : {}) },
        presentation: { summary: claudeToolSummary(name, input), debugAvailable: false } };
      createPart(part, sessionId);
      child.openTools.add(part.id);
      this.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
    } else if (event.type === 'tool-end') {
      const part = getToolPartByCallId(sessionId, `claude-tool:${this.nativeId}:${event.id}`);
      if (!part || !child.openTools.delete(part.id)) throw new Error('Unknown Claude child tool result');
      if (this.children.has(event.id)) this.finish(event.id, event.failed ? 'error' : 'completed');
      const updated = event.failed ? transitionToolToError(part.id, 'Claude tool failed')
        : transitionToolToCompleted(part.id, {
          _visualization: claudeToolVisualization(part.name, part.state.input,
            typeof event.output === 'string' ? event.output : '', event.failed),
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
