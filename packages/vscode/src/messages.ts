/**
 * Message type constants for extension ↔ webview communication.
 *
 * Keep in sync with: packages/client/src/platform/adapters/vscode.ts
 * Every message type string must appear as a named constant in both files.
 */

// Extension → Webview
export const MessageType = {
  Init: 'prokopai:init',
  ThemeChanged: 'prokopai:themeChanged',
  WorkspaceChanged: 'prokopai:workspaceChanged',
  // Webview → Extension
  Ready: 'prokopai:ready',
  OpenFile: 'prokopai:openFile',
  ToggleTerminal: 'prokopai:toggleTerminal',
  ToggleExplorer: 'prokopai:toggleExplorer',
  Connected: 'prokopai:connected',
  Disconnected: 'prokopai:disconnected',
} as const;

export type MessageType = (typeof MessageType)[keyof typeof MessageType];
