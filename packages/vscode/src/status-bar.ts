import * as vscode from 'vscode';
import { state } from './state';

export function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.command = 'prokopai.openChat';
  item.text = '$(comment-discussion) Prokopai';
  item.tooltip = 'Open Prokopai Chat';
  item.show();
  context.subscriptions.push(item);
  state.statusBar = item;
  return item;
}

export function updateStatusBar(connected: boolean) {
  if (state.statusBar) {
    state.statusBar.text = connected
      ? '$(comment-discussion) Prokopai'
      : '$(debug-disconnect) Prokopai';
    state.statusBar.backgroundColor = connected
      ? undefined
      : new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}
