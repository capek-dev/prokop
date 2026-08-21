import type { SessionControlState, SessionControlUpdateReason } from '@prokopai/sdk';
import type { SessionHandlersContext } from './types';
import { useSessionControlStore } from '@/stores/sessionControlStore';

export function handleControlUpdated(
  msg: { type: 'session.control.updated'; control: SessionControlState; reason: SessionControlUpdateReason },
  _ctx: SessionHandlersContext,
): void {
  const { control, reason } = msg;
  useSessionControlStore.getState().setControlState(control.sessionId, control);

  console.log(
    `[control] State updated: sessionId=${control.sessionId} status=${control.status} reason=${reason}`,
  );
}

export function handleActionRejected(
  msg: {
    type: 'session.action_rejected';
    sessionId: string;
    action: string;
    code: string;
    message: string;
    control: SessionControlState;
  },
  _ctx: SessionHandlersContext,
): void {
  const store = useSessionControlStore.getState();
  store.setControlState(msg.sessionId, msg.control);
  store.setActionRejection({
    sessionId: msg.sessionId,
    action: msg.action,
    code: msg.code,
    message: msg.message,
  });

  console.warn(
    `[control] Action rejected: sessionId=${msg.sessionId} action=${msg.action} code=${msg.code} message=${msg.message}`,
  );
}

export const controlHandlers = {
  'session.control.updated': handleControlUpdated,
  'session.action_rejected': handleActionRejected,
} as const;
