import { useState } from 'react';
import { toast } from 'sonner';
import type { ProkopaiClient } from '@prokopai/sdk';
import { usePromptsQuery, useCreatePrompt, useUpdatePrompt, useDeletePrompt } from '@/hooks/queries';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { SettingsEditorHeader, SettingsEmpty, SettingsError, SettingsListRow, SettingsLoading } from './SettingsPrimitives';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

interface PromptInfo {
  name: string;
  description: string;
  content: string;
}

export function PromptsPanel({ sdkClient }: PanelProps) {
  const { data: promptsData, isLoading: loading } = usePromptsQuery(sdkClient);
  const createPromptMut = useCreatePrompt(sdkClient);
  const updatePromptMut = useUpdatePrompt(sdkClient);
  const deletePromptMut = useDeletePrompt(sdkClient);
  const prompts: PromptInfo[] = promptsData?.prompts ?? [];
  const [error, setError] = useState<string | null>(null);

  const [editingPrompt, setEditingPrompt] = useState<PromptInfo | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingPrompt(null);
    setEditName('');
    setEditContent('# New Prompt\n\n');
  };

  const handleEdit = (prompt: PromptInfo) => {
    setEditingPrompt(prompt);
    setIsCreating(false);
    setEditName(prompt.name);
    setEditContent(prompt.content);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (isCreating) {
        await createPromptMut.mutateAsync({ name: editName.trim(), content: editContent });
      } else if (editingPrompt) {
        await updatePromptMut.mutateAsync({ name: editingPrompt.name, body: { content: editContent } });
      }
      setIsCreating(false);
      setEditingPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save prompt');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deletePromptMut.mutateAsync(deleteTarget);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete prompt';
      setError(message);
      toast.error('Failed to delete prompt', { description: message });
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingPrompt(null);
    setEditName('');
    setEditContent('');
  };

  if (isCreating || editingPrompt) {
    return (
      <div className="p-3 sm:p-4 space-y-4">
        <SettingsEditorHeader title={isCreating ? 'New prompt' : 'Edit prompt'} onBack={handleCancel}
          backLabel="Back to prompts" onSave={handleSave} saving={saving} canSave={!!editName.trim()} />

        {error && <SettingsError>{error}</SettingsError>}

        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={!isCreating}
            placeholder="prompt-name"
            className="font-mono"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Content (Markdown)</label>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-48 sm:h-64 p-3 rounded-lg border bg-background font-mono text-sm resize-y"
            placeholder="# Prompt Title\n\nPrompt content here..."
          />
        </div>
      </div>
    );
  }

  if (loading) return <SettingsLoading />;

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {prompts.length} prompt{prompts.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-3" data-icon="inline-start" />
          New Prompt
        </Button>
      </div>

      {error && <SettingsError>{error}</SettingsError>}

      {prompts.length === 0 ? (
        <SettingsEmpty>No prompts yet. Create one to get started.</SettingsEmpty>
      ) : (
        <div className="space-y-1.5">
          {prompts.map((prompt) => (
            <SettingsListRow
              key={prompt.name}
              title={prompt.name}
              description={prompt.description}
              onOpen={() => handleEdit(prompt)}
              actions={(
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => setDeleteTarget(prompt.name)}
                  aria-label={`Delete prompt ${prompt.name}`}
                  title="Delete prompt"
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Prompt"
        description={`Are you sure you want to delete the prompt "${deleteTarget}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deletePromptMut.isPending}
      />
    </div>
  );
}
