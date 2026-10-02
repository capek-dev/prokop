import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface AgentToolsPanelProps {
  memoryEnabled: boolean;
  skillsEnabled: boolean;
  onChangeMemory: (enabled: boolean) => void;
  onChangeSkills: (enabled: boolean) => void;
}

interface ToggleRowProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ id, label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="shrink-0"
      />
    </div>
  );
}

/** Workspace capability toggles. Session search is always on for every
 * workspace, so it has no toggle here. */
export function AgentToolsPanel({
  memoryEnabled,
  skillsEnabled,
  onChangeMemory,
  onChangeSkills,
}: AgentToolsPanelProps) {
  return (
    <div className="space-y-6 p-3 sm:p-4">
      <ToggleRow
        id="memory-enabled"
        label="Memory"
        description="Load memory into context and expose the memory tool"
        checked={memoryEnabled}
        onChange={onChangeMemory}
      />
      <ToggleRow
        id="skills-enabled"
        label="Skills"
        description="Expose the skill_manage tool so the agent can manage workspace skills"
        checked={skillsEnabled}
        onChange={onChangeSkills}
      />
    </div>
  );
}
