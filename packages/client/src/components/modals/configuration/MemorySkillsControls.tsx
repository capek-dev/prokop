import { useId, type ReactElement } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface MemorySkillsControlsProps {
  scope: 'workspace' | 'agent';
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
      <div className="flex min-w-0 flex-col gap-0.5">
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

export function MemorySkillsControls({
  scope,
  memoryEnabled,
  skillsEnabled,
  onChangeMemory,
  onChangeSkills,
}: MemorySkillsControlsProps): ReactElement {
  const id = useId();
  return (
    <div className="flex flex-col gap-3">
      <ToggleRow
        id={`${id}-memory`}
        label="Memory"
        description={scope === 'workspace'
          ? 'Use and maintain shared memory for this workspace.'
          : 'Use and maintain personal memory across workspaces.'}
        checked={memoryEnabled}
        onChange={onChangeMemory}
      />
      <ToggleRow
        id={`${id}-skills`}
        label="Skill management"
        description={scope === 'workspace'
          ? 'Allow agents to create and update workspace skills.'
          : 'Allow this agent to create and update its personal skills.'}
        checked={skillsEnabled}
        onChange={onChangeSkills}
      />
    </div>
  );
}
