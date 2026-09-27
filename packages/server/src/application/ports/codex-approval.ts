export interface CodexApprovalPort {
  getSessionId(toolCallId: string, requestId?: string): string | null;
  resolve(toolCallId: string, response: unknown, requestId?: string): Promise<boolean>;
  hasLiveRequest(requestId: string): boolean;
}

let current: CodexApprovalPort | null = null;

export function installCodexApprovalPort(port: CodexApprovalPort): void {
  current = port;
}

export function getCodexApprovalPort(): CodexApprovalPort | null {
  return current;
}
