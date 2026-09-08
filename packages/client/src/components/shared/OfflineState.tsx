import { WifiOff, RefreshCw } from 'lucide-react';
import type { FC } from 'react';
import { Button } from '@/components/ui/button';

interface OfflineStateProps {
  serverUrl: string | null;
  authError?: string | null;
  retryCount: number;
  nextRetryIn: number;
  onRetry: () => void;
  onLogout: () => void;
}

export const OfflineState: FC<OfflineStateProps> = ({
  serverUrl,
  authError,
  retryCount,
  nextRetryIn,
  onRetry,
  onLogout,
}) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] px-4 text-center">
      <WifiOff className="size-12 text-destructive mb-4" />

      <h2 className="text-xl font-semibold text-foreground mb-2">
        {authError ? 'Authentication required' : 'Reconnecting to server'}
      </h2>

      <p className="text-sm text-muted-foreground mb-4 max-w-[400px]">
        {authError || 'Please check that the server is running.'}
      </p>

      {serverUrl && (
        <p className="text-xs text-muted-foreground mb-6 font-mono bg-muted px-3 py-1.5 rounded">
          {serverUrl}
        </p>
      )}

      <div className="flex flex-col items-center gap-4">
        {!authError && (
          <p role="status" className="text-sm text-muted-foreground">
            {nextRetryIn > 0 ? `Retrying in ${nextRetryIn}s...` : 'Reconnecting...'}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={onRetry} variant="default">
            <RefreshCw className="size-4 mr-2" data-icon="inline-start" />
            Retry Now
          </Button>

          <Button onClick={onLogout} variant="ghost">
            Change Server
          </Button>
        </div>

        {retryCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Retry attempt: {retryCount}
          </p>
        )}
      </div>
    </div>
  );
};
