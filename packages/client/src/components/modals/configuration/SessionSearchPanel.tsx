import type { PermissionRiskLevel } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const RISK_OPTIONS: { value: PermissionRiskLevel; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Auto-approve all searches' },
  { value: 'low', label: 'Low', description: 'Only ask for workspace-wide searches' },
  { value: 'medium', label: 'Medium', description: 'Ask for each search' },
  { value: 'high', label: 'High', description: 'Require explicit approval' },
  { value: 'critical', label: 'Critical', description: 'Always confirm with details' },
];

interface SessionSearchPanelProps {
  enabled: boolean;
  permissionRisk: PermissionRiskLevel;
  includeToolResults: boolean;
  onChange: (settings: { enabled: boolean; permissionRisk: PermissionRiskLevel; includeToolResults: boolean }) => void;
}

export function SessionSearchPanel({ enabled, permissionRisk, includeToolResults, onChange }: SessionSearchPanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="search-enabled">Enable session search</Label>
          <p className="text-xs text-muted-foreground">
            Expose the session_search tool for workspace-scoped message recall
          </p>
        </div>
        <Switch
          id="search-enabled"
          checked={enabled}
          onCheckedChange={(v) => onChange({ enabled: v, permissionRisk, includeToolResults })}
        />
      </div>

      {enabled && (
        <>
          <div className="space-y-3">
            <Label>Permission level for searches</Label>
            <p className="text-xs text-muted-foreground">
              Controls when the agent needs approval to search sessions
            </p>
            <div className="grid gap-2">
              {RISK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange({ enabled, permissionRisk: option.value, includeToolResults })}
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

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-tool-results">Include tool results by default</Label>
              <p className="text-xs text-muted-foreground">
                Search tool output alongside user/assistant messages
              </p>
            </div>
            <Switch
              id="include-tool-results"
              checked={includeToolResults}
              onCheckedChange={(v) => onChange({ enabled, permissionRisk, includeToolResults: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}
