// =============================================================================
// ProkopaiBrowser Popup
//
// Settings UI for the extension popup. Lets the user configure server URL
// and API token, and shows the current connection state.
// Communicates with the background service worker via chrome.runtime messages.
// =============================================================================

import type { ConnectionState } from './types';

const statusBar = document.getElementById('status-bar') as HTMLDivElement;
const statusText = document.getElementById('status-text') as HTMLSpanElement;
const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
const apiTokenInput = document.getElementById('api-token') as HTMLInputElement;
const btnConnect = document.getElementById('btn-connect') as HTMLButtonElement;
const btnDisconnect = document.getElementById('btn-disconnect') as HTMLButtonElement;

function setStatus(state: ConnectionState, text?: string): void {
  statusBar.className = `status-bar ${state}`;
  const labels: Record<ConnectionState, string> = {
    disconnected: 'Disconnected',
    connecting: 'Connecting...',
    connected: 'Connected',
    error: 'Connection failed',
  };
  statusText.textContent = text ?? labels[state];

  const isConnected = state === 'connected';
  const isConnecting = state === 'connecting';

  btnConnect.disabled = isConnected || isConnecting;
  btnDisconnect.disabled = !isConnected && !isConnecting;
  serverUrlInput.disabled = isConnecting || isConnected;
  apiTokenInput.disabled = isConnecting || isConnected;
}

async function loadConfig(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'getState' });
  if (response) {
    serverUrlInput.value = response.serverUrl ?? '';
    apiTokenInput.value = response.token ?? '';
    setStatus(response.state ?? 'disconnected');
  }
}

async function handleConnect(): Promise<void> {
  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) return;

  setStatus('connecting');

  const response = await chrome.runtime.sendMessage({
    type: 'connect',
    serverUrl,
    token: apiTokenInput.value.trim() || undefined,
  });

  setStatus(response?.state ?? 'error', response?.error);
}

async function handleDisconnect(): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  setStatus('disconnected');
}

btnConnect.addEventListener('click', handleConnect);
btnDisconnect.addEventListener('click', handleDisconnect);

loadConfig();
