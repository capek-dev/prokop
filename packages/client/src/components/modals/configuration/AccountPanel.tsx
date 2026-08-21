import type { ProkopaiClient } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import LogoutButton from '@/components/LogoutButton';
import { VersionInfo } from '@/components/VersionInfo';

interface AccountPanelProps {
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
  sdkClient: ProkopaiClient | null;
  open: boolean;
}

export function AccountPanel({ apiToken, isConnected, onLogout, sdkClient, open }: AccountPanelProps) {
  return (
    <div className="p-3 sm:p-4 flex flex-col gap-4">
      <div>
        <Label className="text-sm font-medium">Session</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Manage your current session
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
