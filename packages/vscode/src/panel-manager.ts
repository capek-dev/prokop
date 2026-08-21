import * as vscode from 'vscode';
import { state } from './state';
import { getConfig, getWorkspacePath, getThemeMode, getClientDistDir } from './config';
import { getHtml } from './html';
import { updateStatusBar } from './status-bar';
import { MessageType } from './messages';

export async function createChatPanel(context: vscode.ExtensionContext) {
  if (state.panel) {
    state.panel.reveal(vscode.ViewColumn.Two);
    return;
  }

  const clientDistDir = getClientDistDir(context);
  const isProduction = clientDistDir !== null;

  const iconUri = isProduction
    ? {
        light: vscode.Uri.joinPath(context.extensionUri, 'client-dist', 'icon-192.png'),
        dark: vscode.Uri.joinPath(context.extensionUri, 'client-dist', 'icon-192.png'),
      }
    : undefined;

  state.panel = vscode.window.createWebviewPanel(
    'jean2.chat',
    'Prokopai Chat',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      ...(iconUri ? { iconPath: iconUri } : {}),
      localResourceRoots: isProduction
        ? [clientDistDir!]
        : [],
    },
  );

  console.log('[prokopaicode] Creating panel. Production:', isProduction, 'Port:', state.serverPort);

  if (isProduction && state.serverPort === 0 && state.serverPromise) {
    state.panel.webview.html = '<html><body><p style="font-family:sans-serif;padding:20px">Starting...</p></body></html>';
    try {
      await state.serverPromise;
    } catch (err) {
      console.error('[prokopaicode] Server failed to start:', err);
      state.panel.webview.html = '<html><body><p style="font-family:sans-serif;padding:20px">Failed to start server.</p></body></html>';
      return;
    }
  }

  if (state.panel) {
    state.panel.webview.html = getHtml(state.panel.webview, isProduction, clientDistDir);
  }

  state.panel.onDidDispose(() => {
    state.panel = null;
    updateStatusBar(false);
  });

  // Wait for client readiness before sending init config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const readyListener = state.panel.webview.onDidReceiveMessage((message: any) => {
    if (message.type === MessageType.Ready) {
      readyListener.dispose();
      sendInitConfig(state.panel!.webview);
    }
  }, undefined, context.subscriptions);

  // Handle messages from webview
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state.panel.webview.onDidReceiveMessage((message: any) => {
    switch (message.type) {
      case MessageType.OpenFile:
        if (message.path) {
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(message.path));
        }
        break;
      case MessageType.ToggleTerminal: {
        const existing = vscode.window.terminals.filter((t) => t.name === 'Prokopai');
        if (existing.length > 0 && existing[0] === vscode.window.activeTerminal) {
          for (const t of existing) t.dispose();
        } else {
          const terminal = vscode.window.createTerminal('Prokopai');
          if (message.cwd) {
            terminal.sendText(`cd "${message.cwd}"`, true);
          }
          terminal.show();
        }
        break;
      }
      case MessageType.ToggleExplorer:
        vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility');
        break;
      case MessageType.Connected:
        updateStatusBar(true);
        break;
      case MessageType.Disconnected:
        updateStatusBar(false);
        break;
    }
  }, undefined, context.subscriptions);
}

function sendInitConfig(webview: vscode.Webview) {
  const { serverUrl, token } = getConfig();
  const workspacePath = getWorkspacePath();
  const theme = getThemeMode();

  webview.postMessage({
    type: MessageType.Init,
    config: {
      serverUrl,
      token: token || undefined,
      workspacePath,
      theme,
    },
  });
}
