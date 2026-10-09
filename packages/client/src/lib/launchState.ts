/**
 * How the app opens: where it resumes and what a Dock/taskbar shortcut asks
 * for. Imported first in `main.tsx` so the URL is settled before the router
 * reads it.
 */
import { getLastSelectedServerId } from '@/config/servers';

const LAST_LOCATION_KEY = 'prokopai_last_location';
const ACTION_PARAM = 'action';

export type LaunchAction = 'new-session' | 'overview';

const LAUNCH_ACTIONS: readonly LaunchAction[] = ['new-session', 'overview'];

/** Workspace or overview screens of a server, with their open tabs. */
const RESUMABLE = /^\/server\/([^/?#]+)\/(?:workspace|overview)(?:[/?#]|$)/;
/** Entry points that carry no state of their own. */
const BARE_ENTRY = /^\/(?:server\/([^/?#]+)\/?(?:workspace\/?)?)?$/;

export function parseLaunchAction(search: string): LaunchAction | null {
  const value = new URLSearchParams(search).get(ACTION_PARAM);
  return LAUNCH_ACTIONS.includes(value as LaunchAction) ? value as LaunchAction : null;
}

function readLastLocations(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_LOCATION_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

/** Remembers the last workspace or overview location per server (path + open tabs). */
export function recordLocation(href: string): void {
  const serverId = RESUMABLE.exec(href)?.[1];
  if (!serverId) return;
  const locations = readLastLocations();
  if (locations[serverId] === href) return;
  locations[serverId] = href;
  try {
    localStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(locations));
  } catch {
    // Storage full or unavailable: resuming is best effort.
  }
}

export function lastLocationFor(serverId: string): string | null {
  const href = readLastLocations()[serverId];
  return href && RESUMABLE.exec(href)?.[1] === serverId ? href : null;
}

/**
 * The location to open instead of a bare entry point (`/`, `/server/:id`,
 * `/server/:id/workspace`), or null to keep the current one. Explicit server
 * selection (`?select`) always wins.
 */
export function resumeLocation(pathname: string, search: string, lastServerId: string | null): string | null {
  const params = new URLSearchParams(search);
  params.delete(ACTION_PARAM);
  if (params.size > 0) return null;
  const match = BARE_ENTRY.exec(pathname);
  if (!match) return null;
  const serverId = match[1] ?? lastServerId;
  return serverId ? lastLocationFor(serverId) : null;
}

let pendingAction: LaunchAction | null = null;
const listeners = new Set<() => void>();

export function requestLaunchAction(action: LaunchAction): void {
  pendingAction = action;
  for (const listener of listeners) listener();
}

/** Takes the pending action once `canRun` accepts it; otherwise it stays pending. */
export function takeLaunchAction(canRun: (action: LaunchAction) => boolean): LaunchAction | null {
  const action = pendingAction;
  if (!action || !canRun(action)) return null;
  pendingAction = null;
  return action;
}

export function subscribeLaunchActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface LaunchParams { targetURL?: string }
interface LaunchQueue { setConsumer(consumer: (params: LaunchParams) => void): void }

/**
 * With `launch_handler: focus-existing`, relaunching focuses the open window
 * and hands the launch URL here instead of loading a second copy. Plain
 * relaunches (Dock click) only focus; shortcuts run their action; deep links
 * navigate.
 */
export function installLaunchQueue(navigate: (href: string) => void): void {
  const queue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    if (!params.targetURL) return;
    const url = new URL(params.targetURL);
    if (url.origin !== location.origin) return;
    const action = parseLaunchAction(url.search);
    if (action) {
      requestLaunchAction(action);
      return;
    }
    if (BARE_ENTRY.test(url.pathname) && !url.search) return;
    navigate(url.pathname + url.search + url.hash);
  });
}

// Cold start: capture a shortcut action, then resume the last location before
// the router reads the URL.
{
  const action = parseLaunchAction(location.search);
  if (action) pendingAction = action;
  const resume = resumeLocation(location.pathname, location.search, getLastSelectedServerId());
  if (resume) history.replaceState(history.state, '', resume);
}
