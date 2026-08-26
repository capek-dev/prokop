import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/server/$serverId/agent/$agentId/')({
  beforeLoad: ({ params }) => {
    localStorage.setItem('activeWorkspaceId', `${params.agentId}-home`);
    throw redirect({
      to: '/server/$serverId/workspace',
      params: { serverId: params.serverId },
      replace: true,
    });
  },
});
