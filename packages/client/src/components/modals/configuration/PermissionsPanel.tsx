import { useState } from 'react';
import { RefreshCw, Trash2, ShieldCheck, ShieldHalf, ShieldAlert } from 'lucide-react';
import type { PermissionGrant, PermissionMode } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionListItem } from '../PermissionListItem';
import { ConfirmDialog } from '../ConfirmDialog';

const MODE_OPTIONS: { value: PermissionMode; label: string; icon: typeof ShieldCheck }[] = [
  { value: 'standard', label: 'Standard', icon: ShieldCheck },
  { value: 'extended', label: 'Extended', icon: ShieldHalf },
  { value: 'full', label: 'Full access', icon: ShieldAlert },
];

interface PermissionsPanelProps {
  mode: PermissionMode;
  onModeChange: (mode: PermissionMode) => void;
  permissions: PermissionGrant[];
  onRefreshPermissions: () => void;
  onRevokePermission: (permissionId: string) => void;
  onRevokeAllPermissions: () => void;
}

export function PermissionsPanel({
  mode,
  onModeChange,
  permissions,
  onRefreshPermissions,
  onRevokePermission,
  onRevokeAllPermissions,
}: PermissionsPanelProps) {
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  const activePermissions = permissions.filter((p) => !p.revokedAt);
  const revokedPermissions = permissions.filter((p) => p.revokedAt);

  return (
    <div className="p-3 sm:p-4 space-y-4">
      {/* Default mode: applies immediately, like the default-model select */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-sm font-medium">Default mode for new sessions</Label>
          <p className="text-sm text-muted-foreground">
            Override per session via the shield icon in the chat header
          </p>
        </div>
        <Select value={mode} onValueChange={(v) => onModeChange(v as PermissionMode)}>
          <SelectTrigger size="sm" className="w-36 shrink-0" aria-label="Default permission mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
              <SelectItem key={value} value={value}>
                <Icon className="size-4" />
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Saved Permissions</Label>
          <p className="text-sm text-muted-foreground">
            Tool permissions saved for this workspace
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={onRefreshPermissions}
            className="size-8"
          >
            <RefreshCw className="size-4" />
          </Button>
          {activePermissions.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowRevokeAllConfirm(true)}
            >
              <Trash2 className="size-4" data-icon="inline-start" />
              Revoke All
            </Button>
          )}
        </div>
      </div>

      <Separator />

      <div className="dialog-scrollbar min-h-0 overflow-y-auto" style={{ maxHeight: '50vh' }}>
        {activePermissions.length === 0 && revokedPermissions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No saved permissions yet.
            <br />
            Saved permission grants will appear here after approval.
          </div>
        )}

        {activePermissions.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs uppercase text-muted-foreground mb-2 font-medium">
              Active ({activePermissions.length})
            </h4>
            {activePermissions.map((permission) => (
              <PermissionListItem
                key={permission.id}
                permission={permission}
                onRevoke={onRevokePermission}
              />
            ))}
          </div>
        )}

        {revokedPermissions.length > 0 && (
          <div>
            <h4 className="text-xs uppercase text-muted-foreground mb-2 font-medium">
              Revoked ({revokedPermissions.length})
            </h4>
            {revokedPermissions.map((permission) => (
              <PermissionListItem
                key={permission.id}
                permission={permission}
                onRevoke={onRevokePermission}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showRevokeAllConfirm}
        onOpenChange={setShowRevokeAllConfirm}
        title="Revoke All Permissions"
        description="This will revoke all saved permissions for this workspace. The tools will need to be approved again when used."
        confirmLabel="Revoke All"
        variant="destructive"
        onConfirm={() => {
          onRevokeAllPermissions();
          setShowRevokeAllConfirm(false);
        }}
      />
    </div>
  );
}
