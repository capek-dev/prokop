import { existsSync, realpathSync } from 'node:fs';
import type { AssistantMessage, TextPart, ToolPart } from '@prokopai/sdk';
import type { SDKMessage, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import type { SessionWirePorts } from '@/application/ports/delivery';
import type { SessionExecutionPort } from '@/application/ports/execution';
import { getDatabase } from '@/infrastructure/sqlite/database';
import { getSession, updateSession } from '@/infrastructure/sqlite/session-store';
import { getWorkspace } from '@/infrastructure/sqlite/workspaces';
import { createManagedWorktreeRepository } from '@/infrastructure/sqlite/managed-worktrees';
import { createMessage, createPart, getToolPartByCallId, listMessagesWithParts, transitionToolToCompleted,
  transitionToolToError, transitionToolToInterrupted, updateMessage, updatePart } from '@/infrastructure/sqlite/message-store';
import { getClaudeModelSelection } from './models';
import { claudeCliVersion } from './version';
import { runClaudeTurn } from './sdk-turn';
import { readClaudeGoalVerdict } from './goal-transcript';
import { runClaudeCompact } from './compact';
import { claudeApprovals, type ClaudeApprovals } from './approvals';
import { ClaudeChildTimelines } from './child-timelines';
import { resolveClaudeImages } from './images';
import type { ClaudeTurnUsage } from './usage';

interface Binding {
  native_session_id: string;
  workspace_root: string;
  cli_version: string;
  pending: number;
}

export interface ClaudeExecutionDependencies {
  start?: (prompt: string | AsyncIterable<SDKUserMessage>, options: Options) => AsyncIterable<SDKMessage>;
  approvals?: ClaudeApprovals;
  version?: () => string;
  readGoalVerdict?: typeof readClaudeGoalVerdict;
}

export function createClaudeExecution(deps: ClaudeExecutionDependencies = {}):
  Pick<SessionExecutionPort, 'sendMessage' | 'interruptSession' | 'isSessionActive' | 'compact'> {
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
      if ((!content.trim() && !attachments?.length) || responseFormatId
        || goalMaxTurns !== undefined || goalTokenBudget !== undefined) {
        return reject('Claude CLI supports text and image messages only');
      }
      if (goalCondition !== undefined && (goalCondition !== content || !content.trim()
        || content !== content.trim() || content.length > 4000 || /[\r\n]/.test(content)
        || attachments?.length)) return reject('Invalid Claude goal condition');
      const images = resolveClaudeImages(session, attachments ?? []);
      if (!images) return reject('Claude image attachment is unavailable or unsupported');
      if (session.metadata?.claudeCompactPending) return reject('Claude compaction outcome is uncertain; do not send in this session');
      const priorGoal = session.metadata?.claudeGoal as { status?: string } | undefined;
      if (priorGoal?.status === 'active' || priorGoal?.status === 'uncertain') {
        return reject('Claude goal requires reconciliation; do not send in this session');
      }
      if (active.has(sessionId)) return reject('Claude CLI turn already running');
      const controller = new AbortController();
      active.set(sessionId, controller);
      let assistant: AssistantMessage | null = null;
      let text = '';
      let textPart: TextPart | null = null;
      const openTools = new Set<string>();
      const approvals = deps.approvals ?? claudeApprovals;
      let children: ClaudeChildTimelines | null = null;
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
        const goalStartedAt = Date.now();
        children = new ClaudeChildTimelines(session, nativeId, wire.delivery);
        // Lock the native identity before writing to the process. A lost result never triggers replay.
        if (binding) db.run('UPDATE claude_session_bindings SET pending = 1 WHERE session_id = ?', [sessionId]);
        else db.run(`INSERT INTO claude_session_bindings
          (session_id, native_session_id, workspace_root, cli_version, pending) VALUES (?, ?, ?, ?, 1)`,
        [sessionId, nativeId, root, version]);
        if (goalCondition !== undefined) {
          const updated = updateSession(sessionId, { metadata: { ...(session.metadata ?? {}),
            claudeGoal: { condition: goalCondition, status: 'active', iterations: 0 } } });
          if (!updated) throw new Error('Claude goal state could not be saved');
          wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        const user = createMessage({ id: crypto.randomUUID(), sessionId, role: 'user', createdAt: Date.now() });
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: user });
        if (content.trim()) {
          const inputPart = createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'text',
            text: content, createdAt: Date.now() }, sessionId);
          wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part: inputPart });
        }
        for (const [index, image] of images.entries()) {
          const part = createPart({ id: crypto.randomUUID(), messageId: user.id, type: 'image',
            url: `/api/sessions/${sessionId}/attachments/${image.id}/content?key=${image.accessKey}`,
            mimeType: image.mimeType, createdAt: Date.now() + index + 1 }, sessionId);
          wire.delivery.broadcastToSession(sessionId, { type: 'part.created', sessionId, part });
        }
        wire.actor.attachOriginToSession(origin, sessionId);
        assistant = createMessage({ id: crypto.randomUUID(), sessionId, role: 'assistant', status: 'streaming',
          modelId: selection.model, providerId: 'claude-cli', tokens: { prompt: 0, completion: 0 },
          cost: 0, createdAt: Date.now() }) as AssistantMessage;
        wire.delivery.broadcastToSession(sessionId, { type: 'message.created', message: assistant });
        let result: string | null = null;
        let goalActivated = false;
        let goalCleared = false;
        let usage: ClaudeTurnUsage | null = null;
        let contextUsage: { used: number; window: number } | null = null;
        const toolOwners = new Map<string, string>();
        const backgroundAgents = new Set<string>();
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
        for await (const event of runClaudeTurn({ cwd: root, prompt: content, images,
          goalCondition, sessionId: nativeId, resume: !!binding, model: selection.model, effort: selection.effort,
          controller, canUseTool: approvals.request(sessionId, session.workspaceId, root, wire.delivery,
            controller.signal, id => children?.childSessionId(toolOwners.get(id) ?? '') ?? null),
          onToolOwner: (id, owner) => { if (owner) toolOwners.set(id, owner); },
          start: deps.start })) {
          if (event.type === 'goal-state') {
            if (event.active) {
              if (goalCleared) throw new Error('Claude goal state changed after completion');
              goalActivated = true;
            } else {
              if (!goalActivated) throw new Error('Claude goal cleared without activation');
              goalCleared = true;
            }
            const previous = getSession(sessionId);
            if (!previous) throw new Error('Claude goal session disappeared');
            const updated = updateSession(sessionId, { metadata: { ...(previous.metadata ?? {}),
              claudeGoal: { condition: goalCondition, status: 'active',
                iterations: event.iterations ?? ((previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0) } } });
            if (!updated) throw new Error('Claude goal state could not be saved');
            wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
            continue;
          }
          if (event.type === 'child-start') {
            if (event.background) backgroundAgents.add(event.id);
            continue;
          }
          if (event.type === 'child-finish') {
            backgroundAgents.delete(event.id);
            children.finish(event.id, event.status);
            const part = getToolPartByCallId(sessionId, `claude-tool:${nativeId}:${event.id}`);
            if (part && openTools.delete(part.id)) {
              const updated = event.status === 'completed'
                ? transitionToolToCompleted(part.id, { _visualization: { type: 'none', message: 'Claude agent completed' } })
                : event.status === 'error' ? transitionToolToError(part.id, 'Claude agent failed')
                  : transitionToolToInterrupted(part.id, 'error');
              if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
            }
            continue;
          }
          if (event.parentToolUseId) {
            children.receive(event);
            continue;
          }
          if (event.type === 'compact-boundary') {
            const previous = getSession(sessionId);
            if (previous) {
              const updated = updateSession(sessionId, { metadata: { ...(previous.metadata ?? {}),
                claudeCompactedAt: Date.now(), claudeCompaction: { trigger: event.trigger,
                  preTokens: event.preTokens, postTokens: event.postTokens } } });
              if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
            }
          }
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
            const childId = event.name === 'Agent' ? children.start(event.id) : null;
            const part: ToolPart = { id: crypto.randomUUID(), messageId: assistant.id, type: 'tool',
              callId, name: `Claude ${event.name}`, createdAt: Date.now(),
              state: { status: 'running', input, startedAt: Date.now(),
                ...(childId ? { childSessionId: childId } : {}) },
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
            if (part.name === 'Claude Agent' && backgroundAgents.has(event.id) && !event.failed) {
              // The initial tool result only confirms that the agent was backgrounded.
              // Its task_notification is the terminal signal for the linked timeline.
              continue;
            }
            if (part.name === 'Claude Agent') children.finish(event.id, event.failed ? 'error' : 'completed');
            const updated = event.failed ? transitionToolToError(part.id, 'Claude tool failed')
              : transitionToolToCompleted(part.id, { _visualization: { type: 'none', message: 'Claude tool completed' },
                preview: event.output });
            openTools.delete(part.id);
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part: updated });
          }
          if (event.type === 'result') {
            if (!event.success) throw new Error('Claude CLI turn failed');
            // Later SDK turns can finish background work; they do not replace the user's reply.
            if (result === null) {
              result = event.text;
              usage = event.usage;
            }
          }
          if (event.type === 'context-usage' && result !== null) {
            contextUsage = { used: event.used, window: event.window };
          }
        }
        if (result === null) throw new Error('Claude CLI turn result is missing');
        if (goalCondition !== undefined && !controller.signal.aborted) {
          // CLI 2.1.274 persists evaluator verdicts as goal_status attachments, but
          // does not send active_goal through this SDK stream. Never use a reply as a verdict.
          const iterations = await (deps.readGoalVerdict ?? readClaudeGoalVerdict)({
            root, nativeId, condition: goalCondition, startedAt: goalStartedAt,
          });
          if (iterations === null) {
            console.warn('[claude-cli] goal outcome unconfirmed', { activated: goalActivated,
              cleared: goalCleared, resultSeen: result !== null, aborted: controller.signal.aborted });
            throw new Error('Claude goal outcome is uncertain');
          }
          const previous = getSession(sessionId);
          if (!previous) throw new Error('Claude goal session disappeared');
          const updated = updateSession(sessionId, { metadata: { ...(previous.metadata ?? {}),
            claudeGoal: { condition: goalCondition, status: 'ended',
              iterations: iterations ?? (previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0 } } });
          if (!updated) throw new Error('Claude goal state could not be saved');
          wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        if (controller.signal.aborted) throw new Error('Claude turn interrupted');
        if (!text && result) saveText(result);
        children.close('interrupted');
        const contextSession = getSession(sessionId);
        if (contextSession) {
          const updated = updateSession(sessionId, { metadata: { ...(contextSession.metadata ?? {}),
            claudeContext: contextUsage } });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        }
        const completed = updateMessage(assistant.id, { status: 'completed', completedAt: Date.now(),
          ...(usage ? { tokens: { prompt: usage.prompt + usage.cacheRead + usage.cacheWrite,
            completion: usage.completion }, cost: usage.cost } : {}) });
        if (completed) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: completed });
        if (usage) {
          const previous = getSession(sessionId);
          if (previous) {
            const total = usage.prompt + usage.cacheRead + usage.cacheWrite + usage.completion;
            const updated = updateSession(sessionId, { promptTokens: (previous.promptTokens ?? 0)
              + usage.prompt + usage.cacheRead + usage.cacheWrite,
            completionTokens: (previous.completionTokens ?? 0) + usage.completion,
            totalTokens: (previous.totalTokens ?? 0) + total,
            cacheReadTokens: (previous.cacheReadTokens ?? 0) + usage.cacheRead,
            cacheWriteTokens: (previous.cacheWriteTokens ?? 0) + usage.cacheWrite,
            metadata: { ...(previous.metadata ?? {}), claudeUsage: {
              last: usage, contextWindow: usage.contextWindow } } });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
        }
        db.run('UPDATE claude_session_bindings SET pending = 0 WHERE session_id = ?', [sessionId]);
      } catch (error) {
        if (goalCondition !== undefined && assistant) {
          const previous = getSession(sessionId);
          if (previous) {
            const updated = updateSession(sessionId, { metadata: { ...(previous.metadata ?? {}),
              claudeGoal: { condition: goalCondition, status: 'uncertain',
                iterations: (previous.metadata?.claudeGoal as { iterations?: number } | undefined)?.iterations ?? 0 } } });
            if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
        }
        if (assistant) {
          const updated = updateMessage(assistant.id, { status: controller.signal.aborted ? 'interrupted' : 'error',
            ...(controller.signal.aborted ? {} : { error: error instanceof Error ? error.message : 'Claude CLI turn failed' }),
            completedAt: Date.now() });
          if (updated) wire.delivery.broadcastToSession(sessionId, { type: 'message.updated', message: updated });
        }
        if (!controller.signal.aborted) reject(error instanceof Error ? error.message : 'Claude CLI turn failed');
      } finally {
        children?.close(controller.signal.aborted ? 'interrupted' : 'error');
        approvals.cancelSession(sessionId);
        for (const id of openTools) {
          const part = transitionToolToInterrupted(id, 'error');
          if (part) wire.delivery.broadcastToSession(sessionId, { type: 'part.updated', sessionId, part });
        }
        active.delete(sessionId);
      }
    },
    async compact(sessionId, _reason, delivery) {
      const session = getSession(sessionId);
      if (!session || session.harness !== 'claude-cli' || session.status !== 'active'
        || session.parentId || active.has(sessionId)) {
        return { ok: false, skipped: true, error: 'Claude session is unavailable or busy' };
      }
      if (session.metadata?.claudeCompactPending) {
        return { ok: false, skipped: true, error: 'Claude compaction outcome is uncertain; do not retry in this session' };
      }
      const goalStatus = (session.metadata?.claudeGoal as { status?: string } | undefined)?.status;
      if (goalStatus === 'active' || goalStatus === 'uncertain') {
        return { ok: false, skipped: true, error: 'Claude goal requires reconciliation before compaction' };
      }
      const controller = new AbortController();
      active.set(sessionId, controller);
      let submitted = false;
      let confirmed = false;
      try {
        const workspace = getWorkspace(session.workspaceId);
        if (!workspace || workspace.isVirtual || !workspace.path) throw new Error('Claude workspace unavailable');
        const worktree = session.workspaceRootId
          ? createManagedWorktreeRepository(getDatabase).get(session.workspaceRootId) : null;
        if (session.workspaceRootId && (!worktree || worktree.workspaceId !== session.workspaceId
          || worktree.state !== 'available')) throw new Error('Selected worktree unavailable');
        const root = realpathSync(worktree?.path ?? workspace.path);
        const version = (deps.version ?? claudeCliVersion)();
        const selection = getClaudeModelSelection(sessionId);
        const binding = getDatabase().query<Binding, [string]>(`SELECT native_session_id, workspace_root, cli_version, pending
          FROM claude_session_bindings WHERE session_id = ?`).get(sessionId);
        if (!binding || binding.pending || binding.workspace_root !== root || binding.cli_version !== version
          || !selection) return { ok: false, skipped: true, error: 'Claude turn requires reconciliation before compaction' };
        if (!deps.start && !Bun.which('claude')) {
          return { ok: false, skipped: true, error: 'Claude CLI is unavailable on this host' };
        }
        const pending = updateSession(sessionId, { metadata: { ...(session.metadata ?? {}), claudeCompactPending: true } });
        if (!pending) throw new Error('Claude compaction state could not be saved');
        delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: pending });
        submitted = true;
        const timeout = setTimeout(() => controller.abort(), 120_000);
        let outcome: Awaited<ReturnType<typeof runClaudeCompact>>;
        try {
          outcome = await runClaudeCompact({ cwd: root, nativeId: binding.native_session_id,
            model: selection.model, effort: selection.effort, controller, start: deps.start });
        } finally { clearTimeout(timeout); }
        confirmed = outcome.confirmed;
        const latest = getSession(sessionId);
        if (!latest) throw new Error('Claude session disappeared');
        const { claudeCompactPending: _pending, claudeContext: _context, ...metadata } = latest.metadata ?? {};
        const updated = updateSession(sessionId, { metadata: {
          ...metadata,
          ...(outcome.boundary ? { claudeCompactedAt: Date.now(),
            claudeCompactedAfterMessageId: listMessagesWithParts(sessionId).at(-1)?.message.id ?? null,
            claudeCompaction: { trigger: 'manual', ...outcome.boundary } } : {}),
        } });
        if (!updated) throw new Error('Claude compaction state could not be saved');
        delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
        if (!outcome.boundary) return { ok: false, skipped: true, error: 'Claude did not compact this conversation' };
        return { ok: true, result: { tokensUsed: { prompt: 0, completion: 0 } } };
      } catch (error) {
        // SDK error text can contain prompt data or credentials. Log only the state and error class.
        console.warn('[claude-cli] compact failed', { submitted, confirmed, aborted: controller.signal.aborted,
          errorType: error instanceof Error ? error.name : 'unknown' });
        if (!submitted || confirmed) {
          const latest = getSession(sessionId);
          if (latest?.metadata?.claudeCompactPending) {
            const { claudeCompactPending: _pending, ...metadata } = latest.metadata;
            const updated = updateSession(sessionId, { metadata });
            if (updated) delivery?.broadcastToSession(sessionId, { type: 'session.updated', session: updated });
          }
        }
        return { ok: false, error: submitted && !confirmed
          ? 'Claude compaction outcome is uncertain; do not retry or send in this session'
          : 'Claude compaction could not be completed' };
      } finally {
        active.delete(sessionId);
      }
    },
  };
}
