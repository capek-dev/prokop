import type {
  ControllerGatedAction,
  ServerMessage,
  SessionControlUpdateReason,
} from '@prokopai/sdk';

/**
 * Inward-facing controller ports. The claim/release policy and the
 * controller gate decision live in the named controller domain
 * (`@/domains/controllers`). This module re-exports the domain contracts
 * so transport implementors depend on the application layer only, and
 * keeps the port interfaces the use cases consume.
 */
export * from '@/domains/controllers';

/** Compatibility alias: the pre-S4 port name for the domain action result. */
export type SessionControlActionResult = import('@/domains/controllers').ControlActionResult;

export interface ControllerGatePort<Origin> {
  checkControllerGate(
    sessionId: string,
    action: ControllerGatedAction,
    origin: Origin,
  ): import('@/domains/controllers').ControllerGateRejection | null;
}

export interface SessionControlPort<Origin> {
  claim(
    sessionId: string,
    origin: Origin,
  ): import('@/domains/controllers').ControlActionResult;
  release(
    sessionId: string,
    origin: Origin,
  ): import('@/domains/controllers').ControlActionResult;
  resumeControl(
    sessionId: string,
    origin: Origin,
  ): import('@/domains/controllers').SessionResumeControlResult;
  buildControlUpdatedMessage(sessionId: string, reason: SessionControlUpdateReason): ServerMessage;
}
