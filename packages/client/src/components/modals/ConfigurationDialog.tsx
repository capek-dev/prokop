import { Suspense, lazy, useState } from 'react';
import type { ProkopaiClient } from '@prokopai/sdk';
import { Boxes, FileText, Cog, GraduationCap, Shield, Bot, Braces, MonitorCog, Palette, Keyboard, CircuitBoard, Gauge } from 'lucide-react';
import { getSelectableWorkspaces } from '@/lib/workspaceKind';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useServerUpdate } from '@/hooks/useServerUpdate';
import { useUIStore } from '@/stores/uiStore';
import type { ConfigurationSection } from '@/stores/uiStore';
import { SettingsDialogShell, PanelLoadingFallback, type SettingsGroup, type SettingsSection } from './SettingsDialogShell';
import type { WorkspaceSettingsDraft, WorkspaceSettingsSection } from './configuration/WorkspaceSettingsEditor';
import type { AgentEditorDraft } from './configuration/PreconfigsPanel';
import { WorkspaceSwitcher } from '@/components/layout/WorkspaceSwitcher';

const MCPServersPanel = lazy(() => import('./configuration/MCPServersPanel').then(m => ({ default: m.MCPServersPanel })));
const WorkspacesPanel = lazy(() => import('./configuration/WorkspacesPanel').then(m => ({ default: m.WorkspacesPanel })));
const HarnessesPanel = lazy(() => import('./configuration/HarnessesPanel').then((m) => ({ default: m.HarnessesPanel })));
const UsagePanel = lazy(() => import('./configuration/UsagePanel').then((m) => ({ default: m.UsagePanel })));
const ProvidersModelsPanel = lazy(() => import('./configuration/ProvidersModelsPanel').then((m) => ({ default: m.ProvidersModelsPanel })));
const PromptsPanel = lazy(() => import('./configuration/PromptsPanel').then((m) => ({ default: m.PromptsPanel })));
const PreconfigsPanel = lazy(() => import('./configuration/PreconfigsPanel').then((m) => ({ default: m.PreconfigsPanel })));
const ResponseFormatsPanel = lazy(() => import('./configuration/ResponseFormatsPanel').then((m) => ({ default: m.ResponseFormatsPanel })));
const SystemPanel = lazy(() => import('./configuration/SystemPanel').then((m) => ({ default: m.SystemPanel })));
const AppearancePanel = lazy(() => import('./configuration/AppearancePanel').then((m) => ({ default: m.AppearancePanel })));
const KeybindsPanel = lazy(() => import('./configuration/KeybindsPanel').then((m) => ({ default: m.KeybindsPanel })));

interface ConfigurationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sdkClient: ProkopaiClient | null;
  apiToken: string | null;
  isConnected: boolean;
  onLogout: () => void;
}

const SECTIONS: SettingsSection[] = [
  // Preferences
  { value: 'appearance', label: 'Appearance', icon: Palette, group: 'preferences' },
  { value: 'keybinds', label: 'Keybinds', icon: Keyboard, group: 'preferences' },
  // Server: shared across harnesses (prompts are client-level text shortcuts, harness-agnostic)
  { value: 'mcp', label: 'MCP Servers', icon: Boxes, group: 'server' },
  { value: 'harnesses', label: 'Harnesses', icon: CircuitBoard, group: 'server' },
  { value: 'usage', label: 'Usage', icon: Gauge, group: 'server' },
  { value: 'preconfigs', label: 'Agents', icon: Bot, group: 'server' },
  { value: 'prompts', label: 'Prompts', icon: FileText, group: 'server' },
  // Prokop runtime
  { value: 'providers-models', label: 'Providers & Models', icon: Boxes, group: 'prokop' },
  { value: 'response-formats', label: 'Formats', icon: Braces, group: 'prokop' },
  // System: connection/version, pinned to the bottom
  { value: 'system', label: 'System', icon: MonitorCog, group: 'system' },
];

const WORKSPACE_SECTIONS: SettingsSection[] = [
  { value: 'workspace-general', label: 'General', icon: Cog, group: 'workspace' },
  { value: 'workspace-mcp', label: 'MCP Servers', icon: Boxes, group: 'workspace' },
  { value: 'workspace-permissions', label: 'Permissions', icon: Shield, group: 'workspace' },
  { value: 'workspace-learning', label: 'Memory & Learning', icon: GraduationCap, group: 'workspace' },
];

const WORKSPACE_DESCRIPTIONS: Record<WorkspaceSettingsSection, string> = {
  general: 'Set the default agent, session order, and additional paths for the selected workspace.',
  mcp: 'Manage MCP servers and tool access for the selected workspace.',
  permissions: 'Manage the permission mode and saved approvals for the selected workspace.',
  learning: 'Manage shared memory, skills, and learning for the selected workspace.',
};

const GROUPS: SettingsGroup[] = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'workspace', label: 'Workspace' },
  { key: 'server', label: 'Server' },
  { key: 'prokop', label: 'Prokop' },
  { key: 'system' },
];

export function ConfigurationDialog({
  open,
  onOpenChange,
  sdkClient,
  apiToken,
  isConnected,
  onLogout,
}: ConfigurationDialogProps) {
  const storedSection = useUIStore((s) => s.configurationSection);
  const section = storedSection === 'workspace-agentTools' ? 'workspace-learning'
    : storedSection === 'workspace-sessions' || storedSection === 'workspace-paths' ? 'workspace-general'
      : storedSection;
  const setSection = useUIStore((s) => s.setConfigurationSection);
  // The dialog mounts on open, capturing the workspace it was opened from.
  const [workspaceId, setWorkspaceId] = useState(() => useServerDataStore.getState().activeWorkspace?.id ?? null);
  const [workspaceDrafts, setWorkspaceDrafts] = useState<Record<string, WorkspaceSettingsDraft>>({});
  const [agentDraft, setAgentDraft] = useState<AgentEditorDraft | null>(null);
  const updateVersion = useServerUpdate();
  const workspaces = useServerDataStore(s => s.workspaces);
  const agents = useServerDataStore(s => s.agents);
  const selectable = getSelectableWorkspaces(workspaces, agents);
  const workspace = selectable.find(item => item.id === workspaceId) ?? selectable[0];
  const workspaceSections = workspace ? WORKSPACE_SECTIONS : [];
  const sections = [...SECTIONS, ...workspaceSections];
  const activeSection = sections.some(item => item.value === section) ? section
    : workspace ? 'workspace-general' : 'appearance';
  const groups = GROUPS.map(group => group.key === 'workspace' && !workspace ? {
    ...group,
    control: <p className="px-3 text-xs text-muted-foreground">No workspaces on this server yet.</p>,
  } : group);

  const renderPanel = (value: string) => (
    <Suspense fallback={<PanelLoadingFallback />}>
      {(() => {
        if (value.startsWith('workspace-') && workspace) {
          const workspaceSection = value.slice('workspace-'.length) as WorkspaceSettingsSection;
          return <>
            <div role="group" aria-label="Workspace settings scope" className="flex flex-col gap-2 border-b p-3 sm:p-4">
              <span className="text-sm font-medium">Workspace to configure</span>
              <WorkspaceSwitcher selectionOnly workspaces={selectable} agents={agents} activeWorkspace={workspace}
                onSelectWorkspace={selected => setWorkspaceId(selected.id)} />
              <p className="text-sm text-muted-foreground">{WORKSPACE_DESCRIPTIONS[workspaceSection]}</p>
            </div>
            <WorkspacesPanel workspace={workspace} section={workspaceSection}
              sdkClient={sdkClient} drafts={workspaceDrafts} setDrafts={setWorkspaceDrafts} />
          </>;
        }
        switch (value) {
          case 'system':
            return <SystemPanel apiToken={apiToken} isConnected={isConnected} onLogout={onLogout} sdkClient={sdkClient} open={open} />;
          case 'appearance':
            return <AppearancePanel />;
          case 'keybinds':
            return <KeybindsPanel />;
          case 'mcp':
            return <MCPServersPanel workspaceId={null} sdkClient={sdkClient} />;
          case 'harnesses':
            return <HarnessesPanel sdkClient={sdkClient} />;
          case 'usage':
            return <UsagePanel sdkClient={sdkClient} />;
          case 'preconfigs':
            return <PreconfigsPanel sdkClient={sdkClient} draft={agentDraft} onDraftChange={setAgentDraft} />;
          case 'providers-models':
            return <ProvidersModelsPanel sdkClient={sdkClient} />;
          case 'prompts':
            return <PromptsPanel sdkClient={sdkClient} />;
          case 'response-formats':
            return <ResponseFormatsPanel sdkClient={sdkClient} />;
        }
      })()}
    </Suspense>
  );

  return (
    <SettingsDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Manage preferences, harnesses, agents, and the Prokop runtime"
      sections={sections}
      groups={groups}
      value={activeSection}
      onValueChange={(v) => setSection(v as ConfigurationSection)}
      renderPanel={renderPanel}
      footer={updateVersion ? (
        <p className="text-xs text-muted-foreground">
          Prokop v{updateVersion} available. Run <code>prokop update</code> on the machine hosting this server.
        </p>
      ) : undefined}
    />
  );
}
