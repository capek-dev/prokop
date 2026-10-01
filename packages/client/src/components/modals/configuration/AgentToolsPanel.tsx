import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface AgentToolsPanelProps {
  memoryEnabled: boolean;
  skillsEnabled: boolean;
  searchEnabled: boolean;
  includeToolResults: boolean;
  onChangeMemory: (enabled: boolean) => void;
  onChangeSkills: (enabled: boolean) => void;
  onChangeSearch: (settings: { enabled: boolean; includeToolResults: boolean }) => void;
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

export function AgentToolsPanel({
  memoryEnabled,
  skillsEnabled,
  searchEnabled,
  includeToolResults,
  onChangeMemory,
  onChangeSkills,
  onChangeSearch,
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
      <div className="space-y-2">
        <ToggleRow
          id="search-enabled"
          label="Session search"
          description="Expose the session_search tool for workspace-scoped message recall"
          checked={searchEnabled}
          onChange={(v) => onChangeSearch({ enabled: v, includeToolResults })}
        />
        <div
          className={cn(
            'ml-3 flex items-center justify-between gap-4 rounded-md border border-border bg-muted/30 px-3 py-2.5',
            !searchEnabled && 'hidden',
          )}
        >
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor="include-tool-results" className="text-muted-foreground">
              Include tool results
            </Label>
            <p className="text-xs text-muted-foreground">
              Search tool output alongside user/assistant messages
            </p>
          </div>
          <Switch
            id="include-tool-results"
            checked={includeToolResults}
            onCheckedChange={(v) => onChangeSearch({ enabled: searchEnabled, includeToolResults: v })}
            className="shrink-0"
          />
        </div>
      </div>
    </div>
  );
}
