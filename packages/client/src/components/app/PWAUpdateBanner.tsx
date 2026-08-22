import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePWAUpdateStore } from '@/pwa/updateStore';

export function PWAUpdateBanner() {
  const needRefresh = usePWAUpdateStore((state) => state.needRefresh);
  const dismissed = usePWAUpdateStore((state) => state.dismissed);
  const isUpdating = usePWAUpdateStore((state) => state.isUpdating);
  const dismiss = usePWAUpdateStore((state) => state.dismiss);
  const updateServiceWorker = usePWAUpdateStore((state) => state.updateServiceWorker);

  if (!needRefresh || dismissed) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 px-2 pb-2"
      style={{ paddingTop: 'calc(0.5rem + var(--safe-area-inset-top))' }}
    >
      <Alert className="pointer-events-auto mx-auto max-w-2xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <AlertTitle>Prokopai update ready</AlertTitle>
            <AlertDescription>Restart Prokopai to use the latest version.</AlertDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={dismiss} disabled={isUpdating}>
              Later
            </Button>
            <Button
              size="sm"
              onClick={() => void updateServiceWorker()}
              disabled={isUpdating}
            >
              {isUpdating ? 'Restarting…' : 'Restart now'}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}
