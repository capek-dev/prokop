import { Sun, Moon, Monitor, Eye, Pencil } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@/components/providers/ThemeProvider';
import type { ThemeMode, ThemeScheme } from '@/components/providers/ThemeProvider';
import { useUIStore } from '@/stores/uiStore';
import type { DefaultFileOpenMode } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import { WorkspaceOrderControl } from '@/components/layout/WorkspaceOrderControl';

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
        'flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-colors',
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
      <span className="text-xs text-muted-foreground capitalize">{scheme}</span>
    </button>
  );
}

const MODES: { value: ThemeMode; icon: typeof Sun; label: string }[] = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
];

const OPEN_MODES: { value: DefaultFileOpenMode; icon: typeof Eye; label: string }[] = [
  { value: 'preview', icon: Eye, label: 'Preview files' },
  { value: 'edit', icon: Pencil, label: 'Edit files' },
];

/** Segmented pill matching the shell's tab idiom. */
function SegmentedControl<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: { value: T; icon: typeof Sun; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-0.5" role="group" aria-label={label}>
      {options.map(({ value: option, icon: Icon, label: optionLabel }) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
            value === option
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-3.5" />
          {optionLabel}
        </button>
      ))}
    </div>
  );
}

export function AppearancePanel() {
  const { mode, scheme, setMode, setScheme } = useTheme();
  const { defaultFileOpenMode, setDefaultFileOpenMode } = useUIStore(
    useShallow((s) => ({
      defaultFileOpenMode: s.defaultFileOpenMode,
      setDefaultFileOpenMode: s.setDefaultFileOpenMode,
    })),
  );

  return (
    <div className="p-3 sm:p-4 flex flex-col gap-4">
      <div>
        <Label className="text-sm font-medium">Mode</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Choose light, dark, or system theme
        </p>
        <SegmentedControl label="Theme mode" options={MODES} value={mode} onChange={setMode} />
      </div>

      <Separator />

      <div>
        <Label className="text-sm font-medium">Color scheme</Label>
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

      <Separator />

      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-order">Workspace order</Label>
        <WorkspaceOrderControl />
        <p className="text-sm text-muted-foreground">Applies to the workspace selector on this device, across servers. Recently active uses the latest conversation message, not opening a session.</p>
      </div>

      <Separator />

      <div>
        <Label className="text-sm font-medium">File open mode</Label>
        <p className="text-sm text-muted-foreground mb-3">
          Choose what happens when you click a file. Right-click always offers both actions.
        </p>
        <SegmentedControl label="File open mode" options={OPEN_MODES} value={defaultFileOpenMode}
          onChange={setDefaultFileOpenMode} />
      </div>
    </div>
  );
}
