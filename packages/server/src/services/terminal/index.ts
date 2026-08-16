/**
 * Temporary forwarding module (S2).
 *
 * The terminal WebSocket adapters now live in `transport/terminal`. This
 * module keeps the old import path working with the same singleton and class
 * identities until consumers migrate.
 */
export { OPCODES, encodeFrame, decodeFrame, type Opcode, getTerminalManager, getTerminalEventManager, TerminalManager, TerminalEventManager } from '@/transport/terminal';
