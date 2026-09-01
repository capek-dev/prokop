import { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { Brain, Wrench, Search, Workflow, Server, Shield, FolderSymlink, Clock, ShieldCheck, Cog, Loader2 } from 'lucide-react';
import type { Workspace, WorkspaceSettings, PermissionRiskLevel, PermissionGrant, ProkopaiClient, AutoApproveSeverity } from '@prokopai/sdk';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { SettingsDialogShell, PanelLoadingFallback, type SettingsSection } from './SettingsDialogShell';

const MemoryPanel = lazy(() => import('./configuration/MemoryPanel').then((m) => ({ default: m.MemoryPanel })));
const SkillsPanel = lazy(() => import('./configuration/SkillsPanel').then((m) => ({ default: m.SkillsPanel })));
const SessionSearchPanel = lazy(() => import('./configuration/SessionSearchPanel').then((m) => ({ default: m.SessionSearchPanel })));
const WorkflowPanel = lazy(() => import('./configuration/WorkflowPanel').then((m) => ({ default: m.WorkflowPanel })));
const SchedulingPanel = lazy(() => import('./configuration/SchedulingPanel').then((m) => ({ default: m.SchedulingPanel })));
const MCPServersPanel = lazy(() => import('./configuration/MCPServersPanel').then((m) => ({ default: m.MCPServersPanel })));
const PermissionsPanel = lazy(() => import('./configuration/PermissionsPanel').then((m) => ({ default: m.PermissionsPanel })));
const AdditionalPathsPanel = lazy(() => import('./configuration/AdditionalPathsPanel').then((m) => ({ default: m.AdditionalPathsPanel })));
const AutoApprovePanel = lazy(() => import('./configuration/AutoApprovePanel').then((m) => ({ default: m.AutoApprovePanel })));
const WorkspacePreconfigsPanel = lazy(() => import('./configuration/WorkspacePreconfigsPanel').then((m) => ({ default: m.WorkspacePreconfigsPanel })));

type Section = 'mcp' | 'permissions' | 'paths' | 'autoApprove' | 'memory' | 'skills' | 'search' | 'workflow' | 'scheduling' | 'preconfigs';

const SECTIONS: Omit<SettingsSection, 'icon'>[] = [
  { value: 'mcp', label: 'MCP Servers', group: 'general' },
  { value: 'permissions', label: 'Permissions', group: 'general' },
  { value: 'autoApprove', label: 'Auto-Approve', group: 'general' },
  { value: 'paths', label: 'Additional Paths', group: 'general' },
  { value: 'preconfigs', label: 'Preconfigs', group: 'general' },
  { value: 'memory', label: 'Memory', group: 'capabilities' },
  { value: 'skills', label: 'Skills', group: 'capabilities' },
  { value: 'search', label: 'Session Search', group: 'capabilities' },
  { value: 'workflow', label: 'Workflow', group: 'capabilities' },
  { value: 'scheduling', label: 'Scheduling', group: 'capabilities' },
];

const GROUPS = [
  { key: 'general', label: 'General' },
  { key: 'capabilities', label: 'Capabilities' },
];

/** Sections whose edits are held locally until Save is pressed. */
const DEFERRED_SAVE_SECTIONS = new Set<Section>([
  'memory', 'skills', 'search', 'workflow', 'scheduling', 'autoApprove', 'preconfigs',
]);

const ICONS: Record<Section, SettingsSection['icon']> = {
  mcp: Server,
  permissions: Shield,
  autoApprove: ShieldCheck,
  paths: FolderSymlink,
  preconfigs: Cog,
  memory: Brain,
  skills: Wrench,
  search: Search,
  workflow: Workflow,
  scheduling: Clock,
};

interface WorkspaceSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: Workspace;
  onSave: (workspaceId: string, settings: WorkspaceSettings) => void;
  sdkClient: ProkopaiClient | null;
  permissions: PermissionGrant[];
  onRefreshPermissions: () => void;
  onRevokePermission: (permissionId: string) => void;
  onRevokeAllPermissions: () => void;
  onUpdateWorkspacePaths: (workspaceId: string, additionalPaths: string[]) => void;
  isSaving?: boolean;
}

function snapshot(workspace: Workspace) {
  const s = workspace.settings;
  return {
    memory: { enabled: s?.memory?.enabled ?? false, permissionRisk: s?.memory?.permissionRisk ?? 'medium' as PermissionRiskLevel },
    skills: { enabled: s?.skills?.managementEnabled ?? false, permissionRisk: s?.skills?.permissionRisk ?? 'medium' as PermissionRiskLevel },
    search: {
      enabled: s?.sessionSearch?.enabled ?? false,
      permissionRisk: s?.sessionSearch?.permissionRisk ?? 'medium' as PermissionRiskLevel,
      includeToolResults: s?.sessionSearch?.includeToolResults ?? false,
    },
    workflow: s?.workflow?.enabled ?? false,
    scheduling: { enabled: s?.scheduling?.enabled ?? false, permissionRisk: s?.scheduling?.permissionRisk ?? 'medium' as PermissionRiskLevel },
    autoApprove: s?.autoApproveSeverity ?? 'low' as AutoApproveSeverity,
    preconfigSettings: s?.preconfigs ?? { selectedIds: null, defaultId: null },
  };
}

type DraftState = ReturnType<typeof snapshot>;

export function WorkspaceSettingsDialog({
  open,
  onOpenChange,
  workspace,
  onSave,
  sdkClient,
  permissions,
  onRefreshPermissions,
  onRevokePermission,
  onRevokeAllPermissions,
  onUpdateWorkspacePaths,
  isSaving = false,
}: WorkspaceSettingsDialogProps) {
  const [section, setSection] = useState<Section>('mcp');

  const [draft, setDraft] = useState<DraftState>(() => snapshot(workspace));
  const allPreconfigs = useServerDataStore((s) => s.preconfigs);

  useEffect(() => {
    if (open) {
      setDraft(snapshot(workspace));
    }
  }, [open, workspace.settings]);

  useEffect(() => {
    if (open) {
      onRefreshPermissions();
    }
  }, [open, workspace.id, onRefreshPermissions]);

  const saved = useMemo(() => snapshot(workspace), [workspace.settings]);
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const sectionsWithIcons = useMemo(
    () => SECTIONS.map((s) => ({ ...s, icon: ICONS[s.value as Section] })) satisfies SettingsSection[],
    [],
  );

  const handleSave = () => {
    onSave(workspace.id, {
      ...workspace.settings,
      memory: { enabled: draft.memory.enabled, permissionRisk: draft.memory.permissionRisk },
      skills: { managementEnabled: draft.skills.enabled, permissionRisk: draft.skills.permissionRisk },
      sessionSearch: {
        enabled: draft.search.enabled,
        permissionRisk: draft.search.permissionRisk,
        includeToolResults: draft.search.includeToolResults,
      },
      workflow: { enabled: draft.workflow },
      scheduling: { enabled: draft.scheduling.enabled, permissionRisk: draft.scheduling.permissionRisk },
      autoApproveSeverity: draft.autoApprove,
      preconfigs: draft.preconfigSettings,
    });
    onOpenChange(false);
  };

  const renderPanel = (value: string) => (
    <Suspense fallback={<PanelLoadingFallback />}>
      {(() => {
        switch (value as Section) {
          case 'mcp':
            return <MCPServersPanel workspaceId={workspace.id} sdkClient={sdkClient} />;
          case 'permissions':
            return <PermissionsPanel
              permissions={permissions}
              onRefreshPermissions={onRefreshPermissions}
              onRevokePermission={onRevokePermission}
              onRevokeAllPermissions={onRevokeAllPermissions}
            />;
          case 'paths':
            return <AdditionalPathsPanel
              workspace={workspace}
              onSave={onUpdateWorkspacePaths}
              sdkClient={sdkClient}
            />;
          case 'preconfigs':
            return <WorkspacePreconfigsPanel
              preconfigs={allPreconfigs}
              settings={draft.preconfigSettings}
              onChange={(v) => setDraft((d) => ({ ...d, preconfigSettings: v }))}
            />;
          case 'autoApprove':
            return <AutoApprovePanel
              severity={draft.autoApprove}
              onChange={(v) => setDraft((d) => ({ ...d, autoApprove: v }))}
            />;
          case 'memory':
            return <MemoryPanel
              enabled={draft.memory.enabled}
              permissionRisk={draft.memory.permissionRisk}
              onChange={(v) => setDraft((d) => ({ ...d, memory: v }))}
            />;
          case 'skills':
            return <SkillsPanel
              enabled={draft.skills.enabled}
              permissionRisk={draft.skills.permissionRisk}
              onChange={(v) => setDraft((d) => ({ ...d, skills: v }))}
            />;
          case 'search':
            return <SessionSearchPanel
              enabled={draft.search.enabled}
              permissionRisk={draft.search.permissionRisk}
              includeToolResults={draft.search.includeToolResults}
              onChange={(v) => setDraft((d) => ({ ...d, search: v }))}
            />;
          case 'workflow':
            return <WorkflowPanel
              enabled={draft.workflow}
              onChange={(v) => setDraft((d) => ({ ...d, workflow: v }))}
            />;
          case 'scheduling':
            return <SchedulingPanel
              enabled={draft.scheduling.enabled}
              permissionRisk={draft.scheduling.permissionRisk}
              onChange={(v) => setDraft((d) => ({ ...d, scheduling: v }))}
            />;
        }
      })()}
    </Suspense>
  );

  const showFooter = DEFERRED_SAVE_SECTIONS.has(section);

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Workspace Settings"
      description="Manage workspace configuration: MCP servers, permissions, paths, and capabilities"
      sections={sectionsWithIcons}
      groups={GROUPS}
      value={section}
      onValueChange={(v) => setSection(v as Section)}
      renderPanel={renderPanel}
      footer={showFooter ? (
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !isDirty}>
            {isSaving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {isSaving ? 'Saving...' : isDirty ? 'Save changes' : 'Saved'}
          </Button>
        </DialogFooter>
      ) : undefined}
    />
  );
}
