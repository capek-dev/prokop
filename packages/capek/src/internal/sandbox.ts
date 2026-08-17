/**
 * Internal sandbox entrypoint (`@capekai/core/internal/sandbox`).
 *
 * Exposes exactly the sandbox identities the Jean2 server consumes: the
 * process controller, provider registration, and the wire message types
 * for auto-responder rules and responses. Every symbol resolves to the
 * owning module's identity, identical to the compatibility barrel. S8a.
 */

export { SandboxController, sandboxController } from '../sandbox/controller';
export { SandboxProvider } from '../sandbox/provider';
export type {
  AutoResponderRule,
  SandboxControlEvent,
  SandboxRespondMessage,
  SandboxResponse,
} from '../sandbox/types';
