import { createWiredApplication } from '@/bootstrap/application';
import { installWireApplication } from '@/transport/websocket/application';

/**
 * Installs the production wired application into the transport layer.
 *
 * Use in transport and integration tests that dispatch wire handlers
 * against real registries and the test database. The repository adapter
 * delegates live to the store module, so test database reconfiguration
 * keeps working.
 */
export function installTestWireApplication(): void {
  const application = createWiredApplication();
  installWireApplication({ session: application.session, control: application.control, providers: application.providers, notifications: application.notifications });
}
