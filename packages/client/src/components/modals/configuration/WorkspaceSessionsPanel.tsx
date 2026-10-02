import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SESSION_TAG_ORDERS, isSessionTagOrder, type SessionTagOrder } from '@/lib/sessionTagOrder';
import type { Preconfig } from '@prokopai/sdk';

interface WorkspaceSessionsPanelProps {
  order: SessionTagOrder;
  onChange: (order: SessionTagOrder) => void;
  /** Primary/both preconfigs eligible as the workspace default agent. */
  preconfigs: Preconfig[];
  /** Current default agent id, or null for the server default. */
  defaultAgentId: string | null;
  onDefaultAgentChange: (id: string | null) => void;
}

export function WorkspaceSessionsPanel({
  order,
  onChange,
  preconfigs,
  defaultAgentId,
  onDefaultAgentChange,
}: WorkspaceSessionsPanelProps) {
  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <Label htmlFor="session-tag-order">Session order</Label>
      <p className="text-xs text-muted-foreground">
        Show tagged groups above or below untagged sessions in this workspace.
        Sessions within each group keep their current order.
      </p>
      <Select value={order} onValueChange={value => { if (isSessionTagOrder(value)) onChange(value); }}>
        <SelectTrigger id="session-tag-order" className="w-full sm:w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SESSION_TAG_ORDERS.map(option => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Label htmlFor="default-agent" className="mt-3">Default agent</Label>
      <p className="text-xs text-muted-foreground">
        The agent used for new chats in this workspace. All agents stay available in the chat picker.
      </p>
      <Select
        value={defaultAgentId ?? '__server__'}
        onValueChange={value => onDefaultAgentChange(value === '__server__' ? null : value)}
      >
        <SelectTrigger id="default-agent" className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="__server__">Server default</SelectItem>
            {preconfigs.map(preconfig => (
              <SelectItem key={preconfig.id} value={preconfig.id}>{preconfig.name}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
