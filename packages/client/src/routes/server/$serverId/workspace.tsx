import { createFileRoute } from '@tanstack/react-router';
import WorkspaceView from '@/components/views/WorkspaceView';

export const Route = createFileRoute('/server/$serverId/workspace')({
  component: WorkspaceView,
});
