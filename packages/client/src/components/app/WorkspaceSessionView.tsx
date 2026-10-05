import { useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { SessionPane } from '@/components/board/SessionPane';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';

/** Visit once, then retain the pane through tab switches and dock movement. */
export function WorkspaceSessionView({ sessionId, sdkClient, serverUrl }: {
  sessionId: string;
  sdkClient: ProkopaiClient | null;
  serverUrl: string | null;
}) {
  const visible = useWorkspaceViewVisible();
  const [visited, setVisited] = useState(visible);
  if (visible && !visited) setVisited(true);
  if (!visible && !visited) return null;
  return <SessionPane sessionId={sessionId} sdkClient={sdkClient} serverUrl={serverUrl} />;
}
