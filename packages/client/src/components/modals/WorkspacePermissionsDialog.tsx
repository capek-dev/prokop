import { useState } from 'react';
import { RefreshCw, Trash2, Shield } from 'lucide-react';
import type { PermissionGrant } from '@prokopai/sdk';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PermissionListItem } from './PermissionListItem';
import { ConfirmDialog } from './ConfirmDialog';

interface WorkspacePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permissions: PermissionGrant[];
  onRefreshPermissions: () => void;
  onRevokePermission: (permissionId: string) => void;
  onRevokeAllPermissions: () => void;
  workspaceName?: string;
}

export function WorkspacePermissionsDialog({
  open,
  onOpenChange,
  permissions,
  onRefreshPermissions,
  onRevokePermission,
  onRevokeAllPermissions,
  workspaceName,
}: WorkspacePermissionsDialogProps) {
  const [showRevokeAllConfirm, setShowRevokeAllConfirm] = useState(false);

  const activePermissions = permissions.filter((p) => !p.revokedAt);
  const revokedPermissions = permissions.filter((p) => p.revokedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            Workspace Permissions
          </DialogTitle>
          <DialogDescription>
            {workspaceName
              ? `Manage tool permissions for ${workspaceName}`
              : 'Manage tool permissions for this workspace'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">
                Saved Permissions
              </Label>
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

          <ScrollArea className="h-[350px]">
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
          </ScrollArea>
        </div>
      </DialogContent>

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
    </Dialog>
  );
}
