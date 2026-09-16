import { ArrowDownUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isWorkspaceOrder, WORKSPACE_ORDERS } from '@/lib/workspaceOrder';
import { useUIStore } from '@/stores/uiStore';

export function WorkspaceOrderControl({ compact = false }: { compact?: boolean }) {
  const order = useUIStore(s => s.workspaceOrder);
  const setOrder = useUIStore(s => s.setWorkspaceOrder);
  const change = (value: string) => { if (isWorkspaceOrder(value)) setOrder(value); };

  if (compact) {
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label="Workspace order" title="Workspace order">
            <ArrowDownUp />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuRadioGroup value={order} onValueChange={change}>
            {WORKSPACE_ORDERS.map(option => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Select value={order} onValueChange={change}>
      <SelectTrigger id="workspace-order" aria-label="Workspace order" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {WORKSPACE_ORDERS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
