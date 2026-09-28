export interface ClaudeApprovalPort {
  getSessionId(toolCallId: string, requestId?: string): string | null;
  resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  hasLiveRequest(requestId: string): boolean;
}

let current: ClaudeApprovalPort | null = null;

export function installClaudeApprovalPort(port: ClaudeApprovalPort): void {
  current = port;
}

export function getClaudeApprovalPort(): ClaudeApprovalPort | null {
  return current;
}
