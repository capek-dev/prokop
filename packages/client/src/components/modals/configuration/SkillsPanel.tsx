import type { PermissionRiskLevel } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const RISK_OPTIONS: { value: PermissionRiskLevel; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Auto-approve all writes' },
  { value: 'low', label: 'Low', description: 'Only ask for bulk changes' },
  { value: 'medium', label: 'Medium', description: 'Ask for each write' },
  { value: 'high', label: 'High', description: 'Require explicit approval' },
  { value: 'critical', label: 'Critical', description: 'Always confirm with details' },
];

interface SkillsPanelProps {
  enabled: boolean;
  permissionRisk: PermissionRiskLevel;
  onChange: (settings: { enabled: boolean; permissionRisk: PermissionRiskLevel }) => void;
}

export function SkillsPanel({ enabled, permissionRisk, onChange }: SkillsPanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="skills-enabled">Enable skill management</Label>
          <p className="text-xs text-muted-foreground">
            Expose the skill_manage tool so the agent can manage workspace skills
          </p>
        </div>
        <Switch
          id="skills-enabled"
          checked={enabled}
          onCheckedChange={(v) => onChange({ enabled: v, permissionRisk })}
        />
      </div>

      {enabled && (
        <div className="space-y-3">
          <Label>Permission level for writes</Label>
          <p className="text-xs text-muted-foreground">
            Controls when the agent needs approval to modify skills
          </p>
          <div className="grid gap-2">
            {RISK_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange({ enabled, permissionRisk: option.value })}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  permissionRisk === option.value
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-xs">{option.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
