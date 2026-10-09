import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

import { ServerProvider } from '@/contexts/ServerContext';
import { AttentionStreams } from '@/components/app/AttentionStreams';
import type { ServerRegistry } from '@/lib/serverRegistry';

export interface RouterContext {
  serverRegistry: ServerRegistry;
}

const createRootRoute = createRootRouteWithContext<RouterContext>();

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ServerProvider>
      <AttentionStreams />
      <Outlet />
    </ServerProvider>
  );
}