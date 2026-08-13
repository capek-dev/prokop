import type { InterruptReason, SessionInterruptResult } from '@jean2/sdk';
import { isSandboxActive } from '../compat/jean2-dependencies';
import { sandboxController } from '../sandbox/controller';
import { getChildSessions, getSession, updateSession } from '../storage/runtime';
import { rejectPendingAsksBySession } from '../tools/ask-user-api';

interface ToolExecution {
  controller: AbortController;
  listener: () => void;
}

interface SessionAbortContext {
  sessionId: string;
  parentId?: string;
  controller: AbortController;
  toolControllers: Map<string, ToolExecution>;
  childSessionIds: Set<string>;
  parentAbortListener?: () => void;
}

export class InterruptManager {
  private sessionContexts = new Map<string, SessionAbortContext>();

  registerSession(sessionId: string): AbortController {
    if (this.sessionContexts.has(sessionId)) {
      throw new Error(`Session ${sessionId} already has an active execution`);
    }

    const controller = new AbortController();
    const context: SessionAbortContext = {
      sessionId,
      controller,
      toolControllers: new Map(),
      childSessionIds: new Set(),
    };

    this.sessionContexts.set(sessionId, context);

    const session = getSession(sessionId);
    if (session?.parentId) {
      const parentContext = this.sessionContexts.get(session.parentId);
      if (parentContext) {
        parentContext.childSessionIds.add(sessionId);

        const listener = () => {
          this.interruptSession(sessionId, 'cascade');
        };
        context.parentId = session.parentId;
        context.parentAbortListener = listener;
        parentContext.controller.signal.addEventListener('abort', listener);
      }
    }

    return controller;
  }

  registerToolExecution(sessionId: string, toolCallId: string): AbortController {
    const context = this.sessionContexts.get(sessionId);

    const toolController = new AbortController();

    if (context) {
      const listener = () => {
        toolController.abort();
      };
      context.toolControllers.set(toolCallId, { controller: toolController, listener });
      context.controller.signal.addEventListener('abort', listener);
    }

    return toolController;
  }

  async interruptSession(
    sessionId: string,
    _reason: InterruptReason = 'user_request'
  ): Promise<SessionInterruptResult> {
    const context = this.sessionContexts.get(sessionId);
    const cascadedTo: string[] = [];
    const interruptedTools: string[] = [];
    const rejectedAsks: string[] = [];

    if (context) {
      for (const [toolCallId, { controller: toolController }] of context.toolControllers) {
        if (!toolController.signal.aborted) {
          toolController.abort();
          interruptedTools.push(toolCallId);
        }
      }

      if (!context.controller.signal.aborted) {
        context.controller.abort();
      }

      for (const childId of context.childSessionIds) {
        cascadedTo.push(childId);
      }
    }

    // Reject any pending asks for this session to unblock waiting tool executions
    const pendingAskIds = rejectPendingAsksBySession(sessionId);
    rejectedAsks.push(...pendingAskIds);

    // Reject any pending sandbox calls for this session to unblock waitForResponse()
    if (isSandboxActive()) {
      sandboxController.rejectAllPendingForSession(sessionId);
    }

    // Only set subagentStatus for actual subagent sessions (those with a parentId)
    // Main sessions should not have their status changed to error on interrupt
    const session = getSession(sessionId);
    if (session?.parentId) {
      updateSession(sessionId, {
        subagentStatus: 'interrupted',
      });
    }

    const childSessions = getChildSessions(sessionId);
    for (const child of childSessions) {
      if (child.subagentStatus === 'running') {
        const childResult = await this.interruptSession(child.id, 'cascade');
        cascadedTo.push(...childResult.cascadedTo.filter(id => !cascadedTo.includes(id)));
        interruptedTools.push(...childResult.interruptedTools);
        rejectedAsks.push(...childResult.rejectedAsks);
      }
    }

    return {
      sessionId,
      success: true,
      cascadedTo: [...new Set(cascadedTo)],
      interruptedTools: [...new Set(interruptedTools)],
      rejectedAsks: [...new Set(rejectedAsks)],
    };
  }

  isSessionActive(sessionId: string): boolean {
    const context = this.sessionContexts.get(sessionId);
    return context !== undefined && !context.controller.signal.aborted;
  }

  isSessionInterrupted(sessionId: string): boolean {
    const context = this.sessionContexts.get(sessionId);
    return context?.controller.signal.aborted ?? false;
  }

  unregisterSession(sessionId: string): void {
    const context = this.sessionContexts.get(sessionId);
    if (context) {
      // Remove this session's abort listener from parent's signal
      if (context.parentAbortListener && context.parentId) {
        const parentContext = this.sessionContexts.get(context.parentId);
        if (parentContext) {
          parentContext.controller.signal.removeEventListener('abort', context.parentAbortListener);
          parentContext.childSessionIds.delete(sessionId);
        }
      }

      // Remove all tool execution listeners from this session's signal
      for (const { listener } of context.toolControllers.values()) {
        context.controller.signal.removeEventListener('abort', listener);
      }
    }

    this.sessionContexts.delete(sessionId);
  }

  unregisterToolExecution(sessionId: string, toolCallId: string): void {
    const context = this.sessionContexts.get(sessionId);
    if (context) {
      const toolExec = context.toolControllers.get(toolCallId);
      if (toolExec) {
        context.controller.signal.removeEventListener('abort', toolExec.listener);
      }
      context.toolControllers.delete(toolCallId);
    }
  }
}

export const interruptManager = new InterruptManager();
