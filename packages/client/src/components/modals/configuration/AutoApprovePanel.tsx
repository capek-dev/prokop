import { ShieldOff, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { AutoApproveSeverity } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';

type SeverityLevel = Exclude<AutoApproveSeverity, null>;

interface SeverityOption {
  value: SeverityLevel;
  label: string;
  description: string;
}

const SEVERITY_OPTIONS: SeverityOption[] = [
  { value: 'off', label: 'Off', description: 'Always ask for approval' },
  { value: 'none', label: 'None', description: 'Auto-approve none-risk permissions only' },
  { value: 'low', label: 'Low', description: 'Auto-approve low risk and below' },
  { value: 'medium', label: 'Medium', description: 'Auto-approve medium risk and below' },
  { value: 'high', label: 'High', description: 'Auto-approve high risk and below' },
];

const SEVERITY_ICONS: Record<SeverityLevel, typeof Shield> = {
  off: ShieldOff,
  none: Shield,
  low: ShieldCheck,
  medium: ShieldCheck,
  high: ShieldAlert,
};

interface AutoApprovePanelProps {
  severity: SeverityLevel;
  onChange: (severity: SeverityLevel) => void;
}

export function AutoApprovePanel({ severity, onChange }: AutoApprovePanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="space-y-0.5">
        <Label>Default auto-approve level for new sessions</Label>
        <p className="text-xs text-muted-foreground">
          New sessions in this workspace will start with this auto-approve setting.
          You can still override it per session via the shield icon in the chat header.
        </p>
      </div>

      <div className="grid gap-2">
        {SEVERITY_OPTIONS.map((option) => {
          const Icon = SEVERITY_ICONS[option.value];
          const isActive = severity === option.value;
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
              <div className="flex flex-col">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs">{option.description}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
