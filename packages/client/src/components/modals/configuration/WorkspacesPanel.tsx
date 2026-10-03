import type { Dispatch, SetStateAction } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ProkopaiClient, Workspace, WorkspaceSettings } from '@prokopai/sdk';
import { useServerDataStore } from '@/stores/serverDataStore';
import { WorkspaceSettingsEditor, workspaceSettingsDraft, type WorkspaceSettingsDraft, type WorkspaceSettingsSection } from './WorkspaceSettingsEditor';

interface Props {
  workspace: Workspace;
  section: WorkspaceSettingsSection;
  sdkClient: ProkopaiClient | null;
  drafts: Record<string, WorkspaceSettingsDraft>;
  setDrafts: Dispatch<SetStateAction<Record<string, WorkspaceSettingsDraft>>>;
}

export function WorkspacesPanel({ workspace, section, sdkClient, drafts, setDrafts }: Props) {
  const serverId = useServerDataStore(s => s.serverId);
  const save = useMutation({
    mutationFn: async ({ id, settings, additionalPaths }: {
      id: string; settings: WorkspaceSettings; additionalPaths?: string[]; submittedDraft?: WorkspaceSettingsDraft;
    }) => {
      if (!sdkClient) throw new Error('Connect to a server to save workspace settings.');
      return sdkClient.http.workspaces.update(id, { settings, ...(additionalPaths === undefined ? {} : { additionalPaths }) });
    },
    onSuccess: ({ workspace: updated }, { id, submittedDraft }) => {
      const store = useServerDataStore.getState();
      if (store.serverId !== serverId) return;
      store.setWorkspaces(store.workspaces.map(item => item.id === id ? updated : item));
      if (store.activeWorkspace?.id === id) store.setActiveWorkspace(updated);
      // A response for one workspace must never clear another workspace's draft,
      // or edits made while this request was in flight.
      if (submittedDraft) setDrafts(current => {
        if (current[id] !== submittedDraft) return current;
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
  });

  const draft = drafts[workspace.id] ?? workspaceSettingsDraft(workspace);
  const discard = () => setDrafts(current => {
    const next = { ...current };
    delete next[workspace.id];
    return next;
  });

  return (
    <div className="flex min-w-0 flex-col">
      {save.error && save.variables?.id === workspace.id && <p role="alert" className="p-3 text-sm text-destructive">{save.error.message}</p>}
      <WorkspaceSettingsEditor key={workspace.id} section={section} workspace={workspace} sdkClient={sdkClient} draft={draft}
        onChange={next => setDrafts(current => ({ ...current, [workspace.id]: next }))}
        onDiscard={discard} isSaving={save.isPending && save.variables?.id === workspace.id}
        onSave={(settings, additionalPaths) => save.mutate({ id: workspace.id, settings, additionalPaths, submittedDraft: draft })}
        onSavePermissionMode={settings => save.mutate({ id: workspace.id, settings })} />
    </div>
  );
}
