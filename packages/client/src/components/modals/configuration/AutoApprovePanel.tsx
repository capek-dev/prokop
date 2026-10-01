import { ShieldCheck, ShieldAlert, ShieldHalf } from 'lucide-react';
import type { PermissionMode } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';

interface ModeOption {
  value: PermissionMode;
  label: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'extended', label: 'Extended' },
  { value: 'full', label: 'Full access' },
];

const MODE_ICONS: Record<PermissionMode, typeof ShieldCheck> = {
  standard: ShieldCheck,
  extended: ShieldHalf,
  full: ShieldAlert,
};

interface AutoApprovePanelProps {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}

export function AutoApprovePanel({ mode, onChange }: AutoApprovePanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="space-y-0.5">
        <Label>Default permission mode for new sessions</Label>
        <p className="text-xs text-muted-foreground">
          New sessions in this workspace will start with this permission mode.
          You can still override it per session via the shield icon in the chat header.
        </p>
      </div>

      <div className="grid gap-2">
        {MODE_OPTIONS.map((option) => {
          const Icon = MODE_ICONS[option.value];
          const isActive = mode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
