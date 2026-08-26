import { createFileRoute, redirect } from '@tanstack/react-router';
import { validateBoardSearch } from '@/lib/boardSearch';

export const Route = createFileRoute('/server/$serverId/agent/$agentId/session/$sessionId')({
  validateSearch: validateBoardSearch,
  beforeLoad: ({ params, search }) => {
    localStorage.setItem('activeWorkspaceId', `${params.agentId}-home`);
    throw redirect({
      to: '/server/$serverId/workspace/session/$sessionId',
      params: { serverId: params.serverId, sessionId: params.sessionId },
      search,
      replace: true,
    });
  },
});
