import { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { GraduationCap, Wrench, Server, Shield, FolderSymlink, ShieldCheck, Cog, Loader2 } from 'lucide-react';
import type { Workspace, WorkspaceSettings, PermissionGrant, ProkopaiClient, PermissionMode } from '@prokopai/sdk';
import { getSessionTagOrder } from '@/lib/sessionTagOrder';
import { WorkspaceSessionsPanel } from './configuration/WorkspaceSessionsPanel';
import { learningValidationError } from '@/lib/learningValidation';
import { useServerDataStore } from '@/stores/serverDataStore';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { SettingsDialogShell, PanelLoadingFallback, type SettingsSection } from './SettingsDialogShell';

const AgentToolsPanel = lazy(() => import('./configuration/AgentToolsPanel').then((m) => ({ default: m.AgentToolsPanel })));
const MCPServersPanel = lazy(() => import('./configuration/MCPServersPanel').then((m) => ({ default: m.MCPServersPanel })));
const PermissionsPanel = lazy(() => import('./configuration/PermissionsPanel').then((m) => ({ default: m.PermissionsPanel })));
const AdditionalPathsPanel = lazy(() => import('./configuration/AdditionalPathsPanel').then((m) => ({ default: m.AdditionalPathsPanel })));
const AutoApprovePanel = lazy(() => import('./configuration/AutoApprovePanel').then((m) => ({ default: m.AutoApprovePanel })));
const WorkspacePreconfigsPanel = lazy(() => import('./configuration/WorkspacePreconfigsPanel').then((m) => ({ default: m.WorkspacePreconfigsPanel })));

const LearningPanel = lazy(() => import('./configuration/LearningPanel').then(m => ({ default: m.LearningPanel })));

type Section = 'sessions' | 'learning' | 'mcp' | 'permissions' | 'paths' | 'autoApprove' | 'agentTools' | 'preconfigs';

const SECTIONS: Omit<SettingsSection, 'icon'>[] = [
  { value: 'sessions', label: 'Sessions', group: 'general' },
  { value: 'mcp', label: 'MCP Servers · Prokop', group: 'general' },
  { value: 'permissions', label: 'Permissions', group: 'general' },
  { value: 'autoApprove', label: 'Auto-Approve', group: 'general' },
  { value: 'paths', label: 'Additional Paths', group: 'general' },
  { value: 'preconfigs', label: 'Agents', group: 'general' },
  { value: 'learning', label: 'Learning · Prokop', group: 'capabilities' },
  { value: 'agentTools', label: 'Agent Tools', group: 'capabilities' },
];

const GROUPS = [
  { key: 'general', label: 'General' },
  { key: 'capabilities', label: 'Capabilities' },
];

/** Sections whose edits are held locally until Save is pressed. */
const DEFERRED_SAVE_SECTIONS = new Set<Section>([
  'sessions', 'learning', 'agentTools', 'autoApprove', 'preconfigs',
]);

const ICONS: Record<Section, SettingsSection['icon']> = {
  sessions: Cog,
  mcp: Server,
  permissions: Shield,
  autoApprove: ShieldCheck,
  paths: FolderSymlink,
  preconfigs: Cog,
  learning: GraduationCap,
  agentTools: Wrench,
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
    memory: { enabled: s?.memory?.enabled ?? false },
    skills: { enabled: s?.skills?.managementEnabled ?? false },
    search: {
      enabled: s?.sessionSearch?.enabled ?? false,
      includeToolResults: s?.sessionSearch?.includeToolResults ?? false,
    },
    learning: s?.learning,
    allowPersonalLearning: s?.allowPersonalLearning !== false,
    autoApprove: s?.permissionMode ?? 'standard' as PermissionMode,
    sessionTagOrder: getSessionTagOrder(s?.sessionTagOrder),
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
  const learningError = draft.memory.enabled && draft.search.enabled
    ? learningValidationError(draft.learning, allPreconfigs.map(p => p.id)) : null;

  const sectionsWithIcons = useMemo(
    () => SECTIONS.map((s) => ({ ...s, icon: ICONS[s.value as Section] })) satisfies SettingsSection[],
    [],
  );

  const handleSave = () => {
    if (learningError) return;
    onSave(workspace.id, {
      ...workspace.settings,
      // Capability tools are on/off: always allowed when enabled.
      memory: { enabled: draft.memory.enabled, permissionRisk: 'none' },
      skills: { managementEnabled: draft.skills.enabled, permissionRisk: 'none' },
      sessionSearch: {
        enabled: draft.search.enabled,
        permissionRisk: 'none',
        includeToolResults: draft.search.includeToolResults,
      },
      learning: draft.learning ? { ...draft.learning, enabled: draft.learning.enabled && draft.memory.enabled && draft.search.enabled } : undefined,
      allowPersonalLearning: draft.allowPersonalLearning,
      permissionMode: draft.autoApprove,
      preconfigs: draft.preconfigSettings,
      sessionTagOrder: draft.sessionTagOrder,
    });
    onOpenChange(false);
  };

  const renderPanel = (value: string) => (
    <Suspense fallback={<PanelLoadingFallback />}>
      {(() => {
        switch (value as Section) {
          case 'sessions':
            return <WorkspaceSessionsPanel order={draft.sessionTagOrder}
              onChange={sessionTagOrder => setDraft(d => ({ ...d, sessionTagOrder }))} />;
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
              mode={draft.autoApprove}
              onChange={(v) => setDraft((d) => ({ ...d, autoApprove: v }))}
            />;
          case 'learning':
            return <LearningPanel workspace={workspace} preconfigs={allPreconfigs} value={draft.learning} allowPersonalLearning={draft.allowPersonalLearning}
              onPersonalLearningChange={allowPersonalLearning => setDraft(d => ({ ...d, allowPersonalLearning }))}
              onChange={learning => setDraft(d => ({ ...d, learning,
                memory: learning.enabled ? { ...d.memory, enabled: true } : d.memory,
                search: learning.enabled ? { ...d.search, enabled: true } : d.search,
                skills: learning.enabled && learning.improveSkills ? { ...d.skills, enabled: true } : d.skills,
              }))} />;
          case 'agentTools':
            return <AgentToolsPanel
              memoryEnabled={draft.memory.enabled}
              skillsEnabled={draft.skills.enabled}
              searchEnabled={draft.search.enabled}
              includeToolResults={draft.search.includeToolResults}
              onChangeMemory={(v) => setDraft(d => ({ ...d, memory: { enabled: v } }))}
              onChangeSkills={(v) => setDraft(d => ({ ...d, skills: { enabled: v } }))}
              onChangeSearch={(v) => setDraft(d => ({ ...d, search: v }))}
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
          {learningError && <p role="alert" className="text-xs">{learningError}</p>}
          <Button onClick={handleSave} disabled={isSaving || !isDirty || Boolean(learningError)}>
            {isSaving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            {isSaving ? 'Saving...' : isDirty ? 'Save changes' : 'Saved'}
          </Button>
        </DialogFooter>
      ) : undefined}
    />
  );
}
