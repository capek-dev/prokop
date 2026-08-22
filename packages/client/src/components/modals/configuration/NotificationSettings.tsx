import { useMemo } from 'react';
import { Bell, BellOff, AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useServerUrl } from '@/contexts/ServerClientContext';
import { useNotifications } from '@/hooks/useNotifications';
import { getSavedServers } from '@/config/servers';
import type { NotificationSupport } from '@/notifications/notificationSupport';

const SUPPORT_MESSAGES: Record<NotificationSupport, string> = {
  supported: '',
  unsupported: 'System notifications are not supported in this browser.',
  'insecure-context': 'System notifications require HTTPS.',
  'ios-install-required':
    'Add Prokopai to your Home Screen, then enable notifications from the installed app.',
};

function ToggleSwitch({ enabled, onClick, disabled }: {
  enabled: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        enabled ? 'bg-[var(--switch-checked)]' : 'bg-muted'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

export function NotificationSettings() {
  const serverUrl = useServerUrl();

  const serverInfo = useMemo(() => {
    if (!serverUrl) return null;
    const server = getSavedServers().find(
      (s) => s.url === serverUrl,
    );
    if (!server) return null;
    return {
      serverId: server.id,
      serverName: server.name,
      serverUrl: server.url,
    };
  }, [serverUrl]);

  const {
    support,
    registrationState,
    permission,
    registration,
    error,
    notifyCompletion,
    notifyPermission,
    enable,
    disable,
    updatePrefs,
  } = useNotifications(serverInfo);

  // Don't render anything on unsupported platforms
  if (support === 'unsupported') {
    return null;
  }

  const isEnabling = registrationState === 'enabling';
  const isEnabled = registrationState === 'enabled';
  const isDenied = registrationState === 'denied' || permission === 'denied';

  return (
    <div>
      <Label className="text-sm font-medium mb-3 block">System Notifications</Label>
      <div className="flex flex-col gap-3">
        {/* Status / error messages */}
        {support !== 'supported' && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{SUPPORT_MESSAGES[support]}</span>
          </div>
        )}

        {isDenied && support === 'supported' && (
          <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <span>
              Notification permission was denied. Re-enable it in your browser or system settings.
            </span>
          </div>
        )}

        {error && registrationState === 'error' && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-lg p-3">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Enable / Disable button */}
        {support === 'supported' && !isDenied && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isEnabled ? (
                <Bell className="size-4 text-muted-foreground" />
              ) : (
                <BellOff className="size-4 text-muted-foreground" />
              )}
              <span className="text-sm">
                {isEnabled
                  ? `Enabled for ${registration?.serverName ?? 'server'}`
                  : 'System push notifications'}
              </span>
            </div>
            {isEnabled ? (
              <Button variant="outline" size="sm" onClick={() => void disable()}>
                Disable
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void enable()}
                disabled={isEnabling}
              >
                {isEnabling ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enabling...
                  </>
                ) : (
                  'Enable'
                )}
              </Button>
            )}
          </div>
        )}

        {/* Re-enable after error */}
        {registrationState === 'error' && support === 'supported' && (
          <Button size="sm" onClick={() => void enable()} disabled={isEnabling}>
            {isEnabling ? 'Enabling...' : 'Re-enable notifications'}
          </Button>
        )}

        {/* Preference toggles (only when enabled) */}
        {isEnabled && (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <span className="text-sm">Session completion</span>
              </div>
              <ToggleSwitch
                enabled={notifyCompletion}
                onClick={() => void updatePrefs({
                  completion: !notifyCompletion,
                  permission: notifyPermission,
                })}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="size-4 text-muted-foreground" />
                <span className="text-sm">Permission requests</span>
              </div>
              <ToggleSwitch
                enabled={notifyPermission}
                onClick={() => void updatePrefs({
                  completion: notifyCompletion,
                  permission: !notifyPermission,
                })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
