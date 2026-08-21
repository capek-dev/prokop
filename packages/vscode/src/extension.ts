import * as vscode from 'vscode';
import { VERSION } from './version';
import { state } from './state';
import { getClientDistDir, getWorkspacePath } from './config';
import { startStaticServer, stopServer } from './server';
import { createStatusBarItem } from './status-bar';
import { createChatPanel } from './panel-manager';
import { MessageType } from './messages';

export function activate(context: vscode.ExtensionContext) {
  console.log(`[prokopaicode] v${VERSION} activated`);

  const clientDistDir = getClientDistDir(context);
  if (clientDistDir) {
    state.serverPromise = startStaticServer(clientDistDir.fsPath);
  }

  createStatusBarItem(context);

  const openChat = vscode.commands.registerCommand('prokopai.openChat', () => {
    createChatPanel(context);
  });
  context.subscriptions.push(openChat);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      if (state.panel) {
        const mode = theme.kind === vscode.ColorThemeKind.Dark ||
          theme.kind === vscode.ColorThemeKind.HighContrast
          ? 'dark'
          : 'light';
        state.panel.webview.postMessage({ type: MessageType.ThemeChanged, mode });
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (state.panel) {
        const workspacePath = getWorkspacePath();
        state.panel.webview.postMessage({
          type: MessageType.WorkspaceChanged,
          workspacePath,
        });
      }
    }),
  );

  vscode.commands.executeCommand('prokopai.openChat');
}

export function deactivate() {
  stopServer();
  if (state.statusBar) {
    state.statusBar.dispose();
    state.statusBar = null;
  }
  if (state.panel) {
    state.panel.dispose();
    state.panel = null;
  }
}
