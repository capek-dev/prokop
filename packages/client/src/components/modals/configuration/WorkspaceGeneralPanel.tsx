import { Suspense, lazy, type ReactElement } from 'react';
import type { Preconfig, ProkopaiClient, Workspace } from '@prokopai/sdk';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { SESSION_TAG_ORDERS, isSessionTagOrder, type SessionTagOrder } from '@/lib/sessionTagOrder';
import { PanelLoadingFallback } from '../SettingsDialogShell';
import { DisclosureRow } from './DisclosureRow';

const AdditionalPathsPanel = lazy(() => import('./AdditionalPathsPanel').then(m => ({ default: m.AdditionalPathsPanel })));

interface WorkspaceGeneralPanelProps {
  workspace: Workspace;
  sdkClient: ProkopaiClient | null;
  paths: string[];
  onPathsChange: (paths: string[]) => void;
  order: SessionTagOrder;
  onChange: (order: SessionTagOrder) => void;
  /** Primary/both preconfigs eligible as the workspace default agent. */
  preconfigs: Preconfig[];
  /** Current default agent id, or null for the server default. */
  defaultAgentId: string | null;
  onDefaultAgentChange: (id: string | null) => void;
}

export function WorkspaceGeneralPanel({
  workspace,
  sdkClient,
  paths,
  onPathsChange,
  order,
  onChange,
  preconfigs,
  defaultAgentId,
  onDefaultAgentChange,
}: WorkspaceGeneralPanelProps): ReactElement {
  return (
    <div className="flex flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-agent">Default agent</Label>
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

      <div className="flex flex-col gap-1.5">
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

      <Separator />
      <DisclosureRow label="Additional paths" summary={`${paths.length} path${paths.length === 1 ? '' : 's'}`} defaultOpen={false}>
        <Suspense fallback={<PanelLoadingFallback />}>
          <AdditionalPathsPanel workspace={workspace} sdkClient={sdkClient} paths={paths} onChange={onPathsChange} />
        </Suspense>
      </DisclosureRow>
    </div>
  );
}
