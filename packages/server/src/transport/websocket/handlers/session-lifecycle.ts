import type { RouterContext } from '../router-context';
import type { ConnectionId } from '../connection-id';
import { createWirePorts, requireWireApplication } from '../application';
import type {
  SessionCreateMessage,
  SessionResumeMessage,
  SessionUpdateMessage,
  SessionUpdateModelMessage,
  SessionCloseMessage,
  SessionReopenMessage,
  SessionDeleteMessage,
  SessionRenameMessage,
  SessionGenerateTitleMessage,
  SessionInterruptMessage,
} from '@prokopai/sdk';

/**
 * Session lifecycle wire handlers (S3). These handlers own wire
 * presentation only; the create, resume, update, close, reopen, delete,
 * rename, title, and interrupt orchestration lives in the session
 * lifecycle and transcript use cases.
 */
export async function handleCreateSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionCreateMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.lifecycle.create(wire, ws, {
    workspaceId: msg.workspaceId,
    workspaceRootId: msg.workspaceRootId,
    preconfigId: msg.preconfigId,
    title: msg.title,
  });
}

export async function handleResumeSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionResumeMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.lifecycle.resume(wire, ws, msg.sessionId);
}

export async function handleUpdateSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionUpdateMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.lifecycle.update(wire, ws, {
    sessionId: msg.sessionId,
    preconfigId: msg.preconfigId,
  });
}

export function handleUpdateModelSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionUpdateModelMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.lifecycle.updateModel(wire, ws, {
    sessionId: msg.sessionId,
    modelId: msg.modelId,
    providerId: msg.providerId,
    variant: msg.variant,
  });
}

export function handleCloseSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionCloseMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.lifecycle.close(wire, ws, msg.sessionId);
}

export function handleReopenSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionReopenMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.lifecycle.reopen(wire, ws, msg.sessionId);
}

export function handleDeleteSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionDeleteMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.lifecycle.remove(wire, ws, msg.sessionId);
}

export function handleRenameSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionRenameMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.lifecycle.rename(wire, ws, {
    sessionId: msg.sessionId,
    title: msg.title,
  });
}

export function handleGenerateTitleSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionGenerateTitleMessage,
): void {
  const wire = createWirePorts(ctx);
  requireWireApplication().session.chat.generateTitle(wire, ws, msg.sessionId, true);
}

export async function handleInterruptSession(
  ctx: RouterContext<ConnectionId>,
  ws: ConnectionId,
  msg: SessionInterruptMessage,
): Promise<void> {
  const wire = createWirePorts(ctx);
  await requireWireApplication().session.transcript.interrupt(wire, ws, {
    sessionId: msg.sessionId,
    reason: msg.reason,
  });
}
