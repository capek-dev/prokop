import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function getConfig() {
  const config = vscode.workspace.getConfiguration('prokopai');
  return {
    serverUrl: config.get<string>('serverUrl', 'http://localhost:3000'),
    token: config.get<string>('token', ''),
  };
}

export function getWorkspacePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

export function getThemeMode(): 'dark' | 'light' | 'system' {
  const theme = vscode.window.activeColorTheme;
  if (theme.kind === vscode.ColorThemeKind.Dark ||
    theme.kind === vscode.ColorThemeKind.HighContrast) {
    return 'dark';
  }
  return 'light';
}

export function getClientDistDir(context: vscode.ExtensionContext): vscode.Uri | null {
  try {
    const candidate = vscode.Uri.joinPath(context.extensionUri, 'client-dist');
    const indexPath = path.join(candidate.fsPath, 'index.html');
    return fs.existsSync(indexPath) ? candidate : null;
  } catch {
    return null;
  }
}
