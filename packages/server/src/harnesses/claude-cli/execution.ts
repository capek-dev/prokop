import { existsSync, realpathSync } from 'node:fs';
import type { AssistantMessage, TextPart, ToolPart } from '@prokopai/sdk';
import type { SDKMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { createMessage, createPart, getToolPartByCallId, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import { getClaudeModelSelection } from './models';
import { claudeCliVersion } from './version';
import { runClaudeTurn } from './sdk-turn';
import { claudeApprovals, type ClaudeApprovals } from './approvals';

interface Binding {
  native_session_id: string;
  workspace_root: string;
  cli_version: string;
  pending: number;
}

export interface ClaudeExecutionDependencies {
  start?: (prompt: string, options: Options) => AsyncIterable<SDKMessage>;
  approvals?: ClaudeApprovals;
  version?: () => string;
}

export function createClaudeExecution(deps: ClaudeExecutionDependencies = {}):
  Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive'> {
  const active = new Map<string, AbortController>();
  return {
    isSessionActive: id => active.has(id),
    async interruptSession(id) {
      const controller = active.get(id);
      controller?.abort();
      (deps.approvals ?? claudeApprovals).cancelSession(id);
      return { sessionId: id, success: !!controller, cascadedTo: [], interruptedTools: [], rejectedAsks: [] };
    },
    async sendMessage<Origin>(wire: SessionWirePorts<Origin>, origin: Origin, sessionId: string,
      content: string, attachments?: Array<{ id: string; kind: string }>, responseFormatId?: string,
      goalCondition?: string, goalMaxTurns?: number, goalTokenBudget?: number): Promise<void> {
      const reject = (message: string): void => wire.delivery.send(origin,
        { type: 'error', code: 'invalid_session', message, sessionId });
      const session = getSession(sessionId);
      if (!session || session.harness !== 'claude-cli' || session.parentId || session.status !== 'active') {
        return reject('Not an active Claude CLI session');
      }
      if (!content.trim() || attachments?.length || responseFormatId || goalCondition !== undefined
        || goalMaxTurns !== undefined || goalTokenBudget !== undefined) {
        return reject('Claude CLI currently supports text messages only');
      }
      if (active.has(sessionId)) return reject('Claude CLI turn already running');
      const controller = new AbortController();
      active.set(sessionId, controller);
      let assistant: AssistantMessage | null = null;
      let text = '';
      let textPart: TextPart | null = null;
      const openTools = new Set<string>();
      const approvals = deps.approvals ?? claudeApprovals;
      try {
        const workspace = getWorkspace(session.workspaceId);
        if (!workspace || workspace.isVirtual || !workspace.path) throw new Error('Claude workspace unavailable');
        const path = session.workspaceRootId
          ? createManagedWorktreeRepository(getDatabase).get(session.workspaceRootId) : null;
        if (session.workspaceRootId && (!path || path.workspaceId !== session.workspaceId || path.state !== 'available')) {
          throw new Error('Selected worktree unavailable');
        }
        const selectedRoot = path?.path ?? workspace.path;
        if (!existsSync(selectedRoot)) throw new Error('Claude workspace root unavailable');
        const root = realpathSync(selectedRoot);
        const version = (deps.version ?? claudeCliVersion)();
        const selection = getClaudeModelSelection(sessionId);
        if (!selection) throw new Error('Choose a Claude model and effort before sending');
        const db = getDatabase();
        const binding = db.query<Binding, [string]>(`SELECT native_session_id, workspace_root, cli_version, pending
          FROM claude_session_bindings WHERE session_id = ?`).get(sessionId);
        if (binding && (binding.workspace_root !== root || binding.cli_version !== version || binding.pending)) {
          throw new Error('Claude turn requires reconciliation or its workspace/CLI changed');
        }
        const nativeId = binding?.native_session_id ?? crypto.randomUUID();
        // Lock the native identity before writing to the process. A lost result never triggers replay.
        if (binding) db.run('UPDATE claude_session_bindings SET pending = 1 WHERE session_id = ?', [sessionId]);
        else db.run(`INSERT INTO claude_session_bindings
          (session_id, native_session_id, workspace_root, cli_version, pending) VALUES (?, ?, ?, ?, 1)`,
        [sessionId, nativeId, root, version]);
        const user = createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: user });
        const inputPart = createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'text',
          text: content, createdAt: Date.now() }, sessionId);
        wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: inputPart });
        wire.actor.attachOriginToSession(origin, sessionId);
        assistant = createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'streaming',
          modelId: selection.model, providerId: 'claude-cli', tokens: { prompt: 0, completion: 0 },
          cost: 0, createdAt: Date.now() }) as AssistantMessage;
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });
        let result: string | null = null;
        const saveText = (next: string, delta?: string): void => {
          if (!assistant) return;
          if (!textPart) {
            textPart = createPart({ id: crypto.randomUUID(), messageId: assistant.id, type: 'text',
              text: delta === undefined ? next : '', createdAt: Date.now() }, sessionId) as TextPart;
            wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: textPart });
          }
          if (delta !== undefined) {
            updatePart(textPart.id, { text: next });
            wire.delivery.broadcastToSession(sessionId, { type: 'part.append', sessionId,
              partId: textPart.id, field: 'text', delta });
          } else if (textPart.text !== next) {
            const updated = updatePart(textPart.id, { text: next });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
          }
          textPart = { ...textPart, text: next };
        };
        for await (const event of runClaudeTurn({ cwd: root, prompt: content,
          sessionId: nativeId, resume: !!binding, model: selection.model, effort: selection.effort,
          controller, canUseTool: approvals.request(sessionId, session.workspaceId, root, wire.delivery, controller.signal),
          start: deps.start })) {
          if (event.type === 'text-delta' && event.text) {
            text += event.text;
            saveText(text, event.text);
          }
          if (event.type === 'text-final') {
            if (event.streamed && !text.endsWith(event.streamed)) throw new Error('Claude text stream changed');
            text = text.slice(0, text.length - event.streamed.length) + event.text;
            if (text || textPart) saveText(text);
          }
          if (event.type === 'tool-start') {
            const callId = `claude-tool:${nativeId}:${event.id}`;
            if (getToolPartByCallId(sessionId, callId)) throw new Error('Duplicate Claude tool identity');
            const input = Object.fromEntries(Object.entries(event.input).slice(0, 16).map(([key, value]) => [key.slice(0, 80),
              typeof value === 'string' ? value.slice(0, 1000) : typeof value === 'number' || typeof value === 'boolean' ? value : '[omitted]']));
            const part: ToolPart = { id: crypto.randomUUID(), messageId: assistant.id, type: 'tool',
              callId, name: `Claude ${event.name}`, createdAt: Date.now(),
              state: { status: 'running', input, startedAt: Date.now() },
              presentation: { summary: typeof input.command === 'string' ? input.command.slice(0, 200)
                : typeof input.file_path === 'string' ? input.file_path.slice(0, 200) : event.name,
              debugAvailable: false } };
            createPart(part, sessionId);
            openTools.add(part.id);
            wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
          }
          if (event.type === 'tool-end') {
            const part = getToolPartByCallId(sessionId, `claude-tool:${nativeId}:${event.id}`);
            if (!part || !openTools.has(part.id)) throw new Error('Unknown Claude tool result');
            const updated = event.failed ? transitionToolToError(part.id, 'Claude tool failed')
              : transitionToolToCompleted(part.id, { _visualization: { type: 'none', message: 'Claude tool completed' },
                preview: event.output });
            openTools.delete(part.id);
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
          }
          if (event.type === 'result') {
            if (!event.success) throw new Error('Claude CLI turn failed');
            result = event.text;
          }
        }
        if (result === null) throw new Error('Claude CLI turn result is missing');
        if (!text && result) saveText(result);
        const completed = updateMessage(assistant.id, { status: 'completed', completedAt: Date.now() });
        if (completed) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: completed });
        db.run('UPDATE claude_session_bindings SET pending = 0 WHERE session_id = ?', [sessionId]);
      } catch (error) {
        if (assistant) {
          const updated = updateMessage(assistant.id, { status: controller.signal.aborted ? 'interrupted' : 'error',
            ...(controller.signal.aborted ? {} : { error: error instanceof Error ? error.message : 'Claude CLI turn failed' }),
            completedAt: Date.now() });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
        }
        if (!controller.signal.aborted) reject(error instanceof Error ? error.message : 'Claude CLI turn failed');
      } finally {
        approvals.cancelSession(sessionId);
        for (const id of openTools) {
          const part = transitionToolToInterrupted(id, 'error');
          if (part) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part });
        }
        active.delete(sessionId);
      }
    },
  };
}
