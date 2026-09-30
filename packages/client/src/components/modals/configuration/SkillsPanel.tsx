import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface SkillsPanelProps {
  enabled: boolean;
  onChange: (settings: { enabled: boolean }) => void;
}

export function SkillsPanel({ enabled, onChange }: SkillsPanelProps) {
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
          onCheckedChange={(v) => onChange({ enabled: v })}
        />
      </div>
    </div>
  );
}
