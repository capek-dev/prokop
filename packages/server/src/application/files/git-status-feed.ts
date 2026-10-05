/**
 * Server-owned Git status feed. One serialized computation per workspace
 * root, shared by every subscriber and by HTTP reads, pushed only when the
 * status changed. Replaces per-client refetching after every tool call.
 * Scheduling lives in the shared root feed (`./root-feed`).
 */

import type { GitStatusMessage, GitStatusResponse } from '@prokopai/sdk';
import {
  createRootFeed,
  ROOT_FEED_COLLECT_MS,
  ROOT_FEED_MIN_INTERVAL_MS,
  type RootFeed,
  type RootFeedDependencies,
  type RootFeedReadOptions,
} from './root-feed';

export const GIT_STATUS_COLLECT_MS = ROOT_FEED_COLLECT_MS;
export const GIT_STATUS_MIN_INTERVAL_MS = ROOT_FEED_MIN_INTERVAL_MS;

type Snapshot = Omit<GitStatusResponse, 'revision'>;

export type GitStatusFeedDependencies<Subscriber> =
  Omit<RootFeedDependencies<Subscriber, Snapshot, GitStatusMessage>, 'same' | 'message'>;

export interface GitStatusFeed<Subscriber> extends Omit<RootFeed<Subscriber, Snapshot>, 'read'> {
  /** Current status through the same serialized runner as pushes; `fresh` skips the cache. */
  read(workspaceId: string, rootQuery?: string, options?: RootFeedReadOptions): Promise<GitStatusResponse>;
}

export function createGitStatusFeed<Subscriber>(
  deps: GitStatusFeedDependencies<Subscriber>,
): GitStatusFeed<Subscriber> {
  return createRootFeed<Subscriber, Snapshot, GitStatusMessage>({
    ...deps,
    same: (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
    // Status is small; every subscriber gets the whole snapshot.
    message: ({ workspaceId, root, current }) => ({ type: 'git.status', workspaceId, root, status: current }),
  });
}
