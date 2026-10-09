import { createRouter, RouterProvider } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import { serverRegistry } from '@/lib/serverRegistry';
import { recordLocation } from '@/lib/launchState';

export const router = createRouter({
  routeTree,
  context: { serverRegistry },
  defaultPreload: 'intent',
  // Pending routes keep the current screen; the server route renders the app
  // frame itself, so a generic pending view only ever needs to hold space.
  defaultPendingComponent: () => <div className="size-full bg-background" />,
});

// Remember where each server was left (view and open tabs) so relaunching resumes there.
router.subscribe('onResolved', ({ toLocation }) => recordLocation(toLocation.href));

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export function RouterApp() {
  return <RouterProvider router={router} />;
}