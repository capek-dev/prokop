import {
  createSessionApplication,
  createSessionControlApplication,
  createSessionHttpApplication,
  type SessionApplication,
  type SessionControlApplication,
  type SessionHttpApplication,
} from '@/application';
import { createJean2AskAuthorityPort, createJean2SessionExecution } from '@/adapters/capek';
import { createJean2PendingAskPort, createJean2SessionRepository } from '@/adapters/jean2';
import { createTransportControllerPorts } from '@/transport/websocket/control-port';
import { getAutoApproveTakeover } from '@/env';
import type { ConnectionId } from '@/transport/websocket/connection-id';

export interface WiredApplication {
  session: SessionApplication<ConnectionId>;
  control: SessionControlApplication<ConnectionId>;
  http: SessionHttpApplication;
}

/**
 * Wired application composition (S3).
 *
 * Assembles the session and control use cases with concrete Jean2 ports:
 * the store-backed repository adapter, the Capek compat execution adapter,
 * the transport-owned controller gate and control registry, and the current
 * takeover configuration. Bootstrap installs this into the transport layer;
 * use cases never import store or Capek implementations themselves.
 */
export function createWiredApplication(): WiredApplication {
  const repository = createJean2SessionRepository();
  const execution = createJean2SessionExecution();
  const askAuthority = createJean2AskAuthorityPort();
  const pendingAsks = createJean2PendingAskPort();
  const transportControl = createTransportControllerPorts();

  const session = createSessionApplication<ConnectionId>({
    repository,
    execution,
    gate: transportControl.gate,
    control: transportControl.control,
    pendingAsks,
    askAuthority,
  });

  const control = createSessionControlApplication<ConnectionId>({
    control: transportControl.control,
    autoApproveTakeover: getAutoApproveTakeover,
  });

  const http = createSessionHttpApplication(repository);

  return { session, control, http };
}
