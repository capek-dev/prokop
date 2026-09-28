// Only fixed codes are logged. Never log hook input, commands, paths, native request payloads or tokens.
export type CodexPermissionStage = 'hook' | 'native';
export type CodexPermissionReason =
  | 'invalid-token' | 'invalid-payload' | 'socket-error' | 'workspace-changed'
  | 'working-directory' | 'unknown-turn' | 'unsupported-command' | 'permission-denied'
  | 'handler-error' | 'no-active-turn' | 'malformed-request' | 'unsupported-request'
  | 'unsupported-permissions' | 'ask-declined';

export function logCodexPermissionDenial(stage: CodexPermissionStage, reason: CodexPermissionReason): void {
  console.warn(`[codex-permission] ${stage} denied: ${reason}`);
}
