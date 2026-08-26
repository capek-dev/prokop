import { createFileRoute } from '@tanstack/react-router';
import OverviewView from '@/components/views/OverviewView';

export const Route = createFileRoute('/server/$serverId/overview')({
  component: OverviewView,
});
