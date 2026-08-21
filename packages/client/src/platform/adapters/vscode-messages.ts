/**
 * VSCode webview message type constants.
 *
 * Keep in sync with: packages/vscode/src/messages.ts
 * Every message type string must appear as a named constant in both files.
 */

// Extension → Webview
export const VSMessageType = {
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

export type VSMessageType = (typeof VSMessageType)[keyof typeof VSMessageType];
