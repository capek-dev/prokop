import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface SessionSearchPanelProps {
  enabled: boolean;
  includeToolResults: boolean;
  onChange: (settings: { enabled: boolean; includeToolResults: boolean }) => void;
}

export function SessionSearchPanel({ enabled, includeToolResults, onChange }: SessionSearchPanelProps) {
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
          onCheckedChange={(v) => onChange({ enabled: v, includeToolResults })}
        />
      </div>

      {enabled && (
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
            onCheckedChange={(v) => onChange({ enabled, includeToolResults: v })}
          />
        </div>
      )}
    </div>
  );
}
