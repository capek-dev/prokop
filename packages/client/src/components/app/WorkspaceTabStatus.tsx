import { CircleAlert } from 'lucide-react';
import type { WorkspaceTab } from '@/components/app/workspaceTab';

export function WorkspaceTabStatus({ status }: { status: WorkspaceTab['status'] }) {
  if (!status) return null;
  return status === 'Needs input'
    ? <CircleAlert role="img" aria-label={status} className="size-3 shrink-0 text-warning" />
    : <span role="img" aria-label={status} title={status} className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />;
}
