import { Sun, Moon, Monitor, Volume2, VolumeX } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/components/providers/ThemeProvider';
import type { ThemeMode, ThemeScheme } from '@/components/providers/ThemeProvider';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { NotificationSettings } from './NotificationSettings';

const SCHEMES: ThemeScheme[] = ['neutral', 'ocean', 'forest', 'sunset', 'amethyst'];

/**
 * Scheme preview rendered from the real token cascade: the wrapper carries
 * the scheme class plus both mode classes, so children resolve the exact
 * tokens the app would use. Index.css pairs them as `.light.<scheme>` and
 * `.dark.<scheme>`.
 */
function SchemeButton({ scheme, currentScheme, onClick }: {
  scheme: ThemeScheme;
  currentScheme: ThemeScheme;
  onClick: (scheme: ThemeScheme) => void;
}) {
  const isSelected = scheme === currentScheme;

  return (
    <button
      type="button"
      onClick={() => onClick(scheme)}
      aria-pressed={isSelected}
      title={scheme}
      className={cn(
        'flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all',
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-transparent hover:bg-muted/50',
      )}
    >
      {/* Light mode preview: card on background with primary chip */}
      <div className={cn('light', scheme, 'flex w-full flex-col gap-1 rounded-md border border-border bg-background p-1.5')}>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1.5 w-8 rounded-full bg-primary" />
          <div className="size-3 rounded-full bg-card ring-1 ring-border" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1.5 w-6 rounded-full bg-accent" />
          <div className="size-3 rounded-full bg-primary/20" />
        </div>
      </div>
      {/* Dark mode preview: same structure from the dark tokens */}
      <div className={cn('dark', scheme, 'flex w-full flex-col gap-1 rounded-md border border-border bg-background p-1.5')}>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1.5 w-8 rounded-full bg-primary" />
          <div className="size-3 rounded-full bg-card ring-1 ring-border" />
        </div>
        <div className="flex items-center justify-between gap-1">
          <div className="h-1.5 w-6 rounded-full bg-accent" />
          <div className="size-3 rounded-full bg-primary/20" />
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground capitalize">{scheme}</span>
    </button>
  );
}

const MODES: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

export function AppearancePanel() {
  const { mode, scheme, setMode, setScheme } = useTheme();
  const { chatFinishSoundEnabled, setChatFinishSoundEnabled, permissionSoundEnabled, setPermissionSoundEnabled } = useUIStore(
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
        <Label className="text-sm font-medium">Mode</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Choose light, dark, or system theme
        </p>
        {/* Segmented pill matching the shell's tab idiom */}
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label="Theme mode">
          {MODES.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                mode === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <Label className="text-sm font-medium mb-3 block">Notification Sounds</Label>
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
              <VolumeX className="size-4 text-muted-foreground" />
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

      <Separator />

      <div>
        <Label className="text-sm font-medium">Color Scheme</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Previews render the live tokens for both modes
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {SCHEMES.map((s) => (
            <SchemeButton
              key={s}
              scheme={s}
              currentScheme={scheme}
              onClick={setScheme}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
