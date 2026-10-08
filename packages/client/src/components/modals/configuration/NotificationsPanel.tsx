import { Volume2, BellRing } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { NotificationSettings } from './NotificationSettings';

export function NotificationsPanel() {
  const {
    chatFinishSoundEnabled,
    setChatFinishSoundEnabled,
    permissionSoundEnabled,
    setPermissionSoundEnabled,
  } = useUIStore(
    useShallow((s) => ({
      chatFinishSoundEnabled: s.chatFinishSoundEnabled,
      setChatFinishSoundEnabled: s.setChatFinishSoundEnabled,
      permissionSoundEnabled: s.permissionSoundEnabled,
      setPermissionSoundEnabled: s.setPermissionSoundEnabled,
    })),
  );

  return (
    <div className="p-3 sm:p-4 flex flex-col gap-4">
      <div>
        <Label className="text-sm font-medium">Sounds</Label>
        <p className="text-sm text-muted-foreground mb-3">Play a sound in this app when something needs you</p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="size-4 text-muted-foreground" />
              <span className="text-sm">Chat completion</span>
            </div>
            <Switch
              checked={chatFinishSoundEnabled}
              onCheckedChange={setChatFinishSoundEnabled}
              aria-label="Chat completion sound"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="size-4 text-muted-foreground" />
              <span className="text-sm">Permission requests</span>
            </div>
            <Switch
              checked={permissionSoundEnabled}
              onCheckedChange={setPermissionSoundEnabled}
              aria-label="Permission request sound"
            />
          </div>
        </div>
      </div>

      <Separator />

      <NotificationSettings />
    </div>
  );
}
