import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/server/$serverId/agent/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/server/$serverId/workspace',
      params: { serverId: params.serverId },
      replace: true,
    });
  },
});
