import type { ProkopaiClient } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import LogoutButton from '@/components/LogoutButton';
import { VersionInfo } from '@/components/VersionInfo';

interface SystemPanelProps {
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
  sdkClient: ProkopaiClient | null;
  open: boolean;
}

export function SystemPanel({ apiToken, isConnected, onLogout, sdkClient, open }: SystemPanelProps) {
  return (
    <div className="p-3 sm:p-4 flex flex-col gap-4">
      <div>
        <Label className="text-sm font-medium">Connection</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Manage your connection to this server
        </p>
        {isConnected ? (
          <LogoutButton token={apiToken} onLogout={onLogout} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No active session
          </p>
        )}
      </div>

      <Separator />

      <VersionInfo sdkClient={sdkClient} enabled={open} />
    </div>
  );
}
