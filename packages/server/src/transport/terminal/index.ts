export { OPCODES, encodeFrame, decodeFrame } from './frames';
export type { Opcode } from './frames';

import { TerminalManager } from './manager';
import { TerminalEventManager } from './event-manager';
import type { TerminalSessionStorePort } from '@/application/ports/terminal';

let _instance: TerminalManager | null = null;
let _eventManager: TerminalEventManager | null = null;
let _storePort: TerminalSessionStorePort | null = null;

/**
 * Installs the terminal session persistence port (S5 PTY/terminal
 * persistence isolation). The lazy manager singleton keeps its identity;
 * if it was already created, the port is swapped in without recreating
 * sessions or event wiring.
 */
export function installTerminalSessionStore(store: TerminalSessionStorePort): void {
  _storePort = store;
  if (_instance) {
    _instance.setStorePort(store);
  }
}

export function getTerminalManager(): TerminalManager {
  if (!_instance) {
    _instance = new TerminalManager(_storePort ?? undefined);
    _instance.setEventManagerGetter(getTerminalEventManager);
  }
  return _instance;
}

export function getTerminalEventManager(): TerminalEventManager {
  if (!_eventManager) {
    _eventManager = new TerminalEventManager();
  }
  return _eventManager;
}

export { TerminalManager, TerminalEventManager };
