export { OPCODES, encodeFrame, decodeFrame } from './frames';
export type { Opcode } from './frames';
import { TerminalManager } from './manager';
import { TerminalEventManager } from './event-manager';

let _instance: TerminalManager | null = null;
let _eventManager: TerminalEventManager | null = null;

export function getTerminalManager(): TerminalManager {
  if (!_instance) {
    _instance = new TerminalManager();
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
