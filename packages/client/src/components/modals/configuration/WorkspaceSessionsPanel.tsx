import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SESSION_TAG_ORDERS, isSessionTagOrder, type SessionTagOrder } from '@/lib/sessionTagOrder';

interface WorkspaceSessionsPanelProps {
  order: SessionTagOrder;
  onChange: (order: SessionTagOrder) => void;
}

export function WorkspaceSessionsPanel({ order, onChange }: WorkspaceSessionsPanelProps) {
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
    </div>
  );
}
