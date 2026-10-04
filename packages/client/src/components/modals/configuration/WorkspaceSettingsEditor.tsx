import { Suspense, lazy } from 'react';
import type { ProkopaiClient, Workspace, WorkspaceSettings } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getSessionTagOrder, type SessionTagOrder } from '@/lib/sessionTagOrder';
import { learningValidationError } from '@/lib/learningValidation';
import { useServerDataStore } from '@/stores/serverDataStore';
import { useWorkspacePermissions } from '@/hooks/useWorkspacePermissions';
import { PanelLoadingFallback } from '../SettingsDialogShell';
import { WorkspaceGeneralPanel } from './WorkspaceGeneralPanel';
import { MemorySkillsControls } from './MemorySkillsControls';

const MCPServersPanel = lazy(() => import('./MCPServersPanel').then(m => ({ default: m.MCPServersPanel })));
const PermissionsPanel = lazy(() => import('./PermissionsPanel').then(m => ({ default: m.PermissionsPanel })));
const LearningPanel = lazy(() => import('./LearningPanel').then(m => ({ default: m.LearningPanel })));

export type WorkspaceSettingsSection = 'general' | 'mcp' | 'permissions' | 'learning';

export interface WorkspaceSettingsDraft {
  memory: { enabled: boolean };
  skills: { enabled: boolean };
  learning: WorkspaceSettings['learning'];
  allowPersonalLearning: boolean;
  sessionTagOrder: SessionTagOrder;
  defaultAgentId: string | null;
  additionalPaths: string[];
}

export function workspaceSettingsDraft(workspace: Workspace): WorkspaceSettingsDraft {
  const settings = workspace.settings;
  return {
    memory: { enabled: settings?.memory?.enabled ?? false },
    skills: { enabled: settings?.skills?.managementEnabled ?? false },
    learning: settings?.learning,
    allowPersonalLearning: settings?.allowPersonalLearning !== false,
    sessionTagOrder: getSessionTagOrder(settings?.sessionTagOrder),
    defaultAgentId: settings?.preconfigs?.defaultId ?? null,
    additionalPaths: workspace.additionalPaths ?? [],
  };
}

interface Props {
  section: WorkspaceSettingsSection;
  workspace: Workspace;
  sdkClient: ProkopaiClient | null;
  draft: WorkspaceSettingsDraft;
  onChange: (draft: WorkspaceSettingsDraft) => void;
  onSave: (settings: WorkspaceSettings, additionalPaths: string[]) => void;
  onSavePermissionMode: (settings: WorkspaceSettings) => void;
  onDiscard: () => void;
  isSaving: boolean;
}

export function WorkspaceSettingsEditor({ section, workspace, sdkClient, draft, onChange, onSave,
  onSavePermissionMode, onDiscard, isSaving }: Props) {
  const allPreconfigs = useServerDataStore(s => s.preconfigs);
  const { permissions, refresh, revoke, revokeAll } = useWorkspacePermissions(sdkClient, workspace.id);
  const primaryPreconfigs = allPreconfigs.filter(p => p.mode !== 'subagent');
  const isAgentHome = workspace.settings?.isAgentHome === true;
  const activeSection = section;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(workspaceSettingsDraft(workspace));
  const learningError = draft.memory.enabled
    ? learningValidationError(draft.learning, allPreconfigs.map(p => p.id)) : null;
  const setDraft = (update: Partial<WorkspaceSettingsDraft>) => onChange({ ...draft, ...update });

  const save = () => {
    if (learningError) return;
    onSave({
      ...workspace.settings,
      memory: { enabled: draft.memory.enabled, permissionRisk: 'none' },
      skills: { managementEnabled: draft.skills.enabled, permissionRisk: 'none' },
      learning: draft.learning ? { ...draft.learning, enabled: draft.learning.enabled && draft.memory.enabled } : undefined,
      allowPersonalLearning: draft.allowPersonalLearning,
      preconfigs: { selectedIds: null, defaultId: draft.defaultAgentId },
      sessionTagOrder: draft.sessionTagOrder,
    }, draft.additionalPaths);
  };

  return (
    <div className="flex min-w-0 flex-col">
      <Suspense fallback={<PanelLoadingFallback />}>
        {activeSection === 'general' && <WorkspaceGeneralPanel order={draft.sessionTagOrder}
          onChange={sessionTagOrder => setDraft({ sessionTagOrder })} preconfigs={primaryPreconfigs}
          workspace={workspace} sdkClient={sdkClient} paths={draft.additionalPaths}
          onPathsChange={additionalPaths => setDraft({ additionalPaths })}
          defaultAgentId={draft.defaultAgentId} onDefaultAgentChange={defaultAgentId => setDraft({ defaultAgentId })} />}
        {activeSection === 'mcp' && <MCPServersPanel workspaceId={workspace.id} sdkClient={sdkClient} />}
        {activeSection === 'permissions' && <PermissionsPanel mode={workspace.settings?.permissionMode ?? 'standard'}
          onModeChange={permissionMode => onSavePermissionMode({ ...workspace.settings, permissionMode })}
          permissions={permissions} onRefreshPermissions={refresh} onRevokePermission={revoke} onRevokeAllPermissions={revokeAll} />}
        {activeSection === 'learning' && <div className="flex flex-col gap-3 p-3 sm:p-4">
          <MemorySkillsControls scope="workspace" memoryEnabled={draft.memory.enabled} skillsEnabled={draft.skills.enabled}
            onChangeMemory={enabled => setDraft({ memory: { enabled } })}
            onChangeSkills={enabled => setDraft({ skills: { enabled } })} />
          <Separator />
          {isAgentHome ? (
            <p className="text-xs text-muted-foreground">
              Configure this agent's personal learning in Agents under Memory &amp; Learning.
            </p>
          ) : <LearningPanel workspace={workspace} preconfigs={allPreconfigs}
          value={draft.learning} allowPersonalLearning={draft.allowPersonalLearning}
          onPersonalLearningChange={allowPersonalLearning => setDraft({ allowPersonalLearning })}
          onChange={learning => setDraft({ learning,
            memory: learning.enabled ? { enabled: true } : draft.memory,
            skills: learning.enabled && learning.improveSkills ? { enabled: true } : draft.skills,
          })} />}
        </div>}
      </Suspense>
      {(isDirty || ['general', 'learning'].includes(activeSection)) && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background p-3 sm:p-4">
          {learningError && <p role="alert" className="mr-auto text-xs text-destructive">{learningError}</p>}
          {isDirty && <Button variant="ghost" onClick={onDiscard} disabled={isSaving}>Discard changes</Button>}
          <Button onClick={save} disabled={!sdkClient || isSaving || !isDirty || Boolean(learningError)}>
            {isSaving ? 'Saving...' : isDirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  );
}
