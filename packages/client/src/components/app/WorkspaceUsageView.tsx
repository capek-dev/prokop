import { lazy, Suspense } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { useWorkspaceViewVisible } from '@/components/app/WorkspaceViewHost';

const UsagePanel = lazy(() => import('@/components/modals/configuration/UsagePanel').then((module) => ({ default: module.UsagePanel })));

export function WorkspaceUsageView({ sdkClient }: { sdkClient: ProkopaiClient | null }) {
  const visible = useWorkspaceViewVisible();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Usage">
      {visible && <Suspense fallback={<p className="p-3 text-sm text-muted-foreground">Loading usage…</p>}>
        <UsagePanel sdkClient={sdkClient} />
      </Suspense>}
    </div>
  );
}
