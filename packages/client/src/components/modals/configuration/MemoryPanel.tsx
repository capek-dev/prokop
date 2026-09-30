import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface MemoryPanelProps {
  enabled: boolean;
  onChange: (settings: { enabled: boolean }) => void;
}

export function MemoryPanel({ enabled, onChange }: MemoryPanelProps) {
  return (
    <div className="p-3 sm:p-4 space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="memory-enabled">Enable memory</Label>
          <p className="text-xs text-muted-foreground">
            Load memory into context and expose the memory tool
          </p>
        </div>
        <Switch
          id="memory-enabled"
          checked={enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
        />
      </div>
    </div>
  );
}
