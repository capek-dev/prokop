import { useState } from 'react';
import type { ProkopaiClient, ModelWithStatus } from '@prokopai/sdk';
import { useCreateModel, useUpdateModel } from '@/hooks/queries';
import {
  Plus,
  Trash2,
  Loader2,
  Check,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsError } from '../SettingsPrimitives';

interface ModelFormData {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens?: number;
  variants?: Record<string, { providerOptions: Record<string, unknown> }>;
  capabilities?: {
    input?: { text?: boolean; image?: boolean; video?: boolean; file?: string[] };
    structuredOutput?: { mode: 'native' | 'prompt' };
  };
}

const emptyModelForm: ModelFormData = { id: '', name: '', contextWindow: 128000, maxOutputTokens: undefined };

function updateCapabilities(
  form: ModelFormData,
  field: 'text' | 'image' | 'video',
  value: boolean,
): ModelFormData {
  const input = { ...(form.capabilities?.input) };
  input[field] = value;
  const hasInputCaps = input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0);
  const hasOtherCaps = !!form.capabilities?.structuredOutput;
  return {
    ...form,
    capabilities: (hasInputCaps || hasOtherCaps)
      ? { ...(hasInputCaps ? { input } : {}), ...(form.capabilities?.structuredOutput ? { structuredOutput: form.capabilities.structuredOutput } : {}) }
      : undefined,
  };
}

function updateFileTypes(form: ModelFormData, raw: string): ModelFormData {
  const file = raw.trim() ? raw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
  const input = { ...form.capabilities?.input, file };
  const hasInputCaps = input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0);
  const hasOtherCaps = !!form.capabilities?.structuredOutput;
  return {
    ...form,
    capabilities: (hasInputCaps || hasOtherCaps) ? { ...(hasInputCaps ? { input } : {}), ...form.capabilities?.structuredOutput ? { structuredOutput: form.capabilities.structuredOutput } : {} } : undefined,
  };
}

function updateStructuredOutputMode(form: ModelFormData, mode: 'native' | 'prompt' | 'none'): ModelFormData {
  const input = form.capabilities?.input;
  const hasInputCaps = input && (input.text || input.image || input.video || (Array.isArray(input.file) && input.file.length > 0));
  if (mode === 'none') {
    return {
      ...form,
      capabilities: hasInputCaps ? { input } : undefined,
    };
  }
  return {
    ...form,
    capabilities: {
      ...(hasInputCaps ? { input } : {}),
      structuredOutput: { mode },
    },
  };
}

interface ModelEditorFormProps {
  sdkClient: ProkopaiClient | null;
  providerId: string;
  providerName: string;
  /** null creates a new model. */
  model: ModelWithStatus | null;
  onDone: () => void;
}

/** Create/edit form for one model, extracted from the old ModelsPanel. */
export function ModelEditorForm({ sdkClient, providerId, providerName, model, onDone }: ModelEditorFormProps) {
  const createModelMut = useCreateModel(sdkClient);
  const updateModelMut = useUpdateModel(sdkClient);
  const [form, setForm] = useState<ModelFormData>(model ? {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    variants: model.variants,
    capabilities: model.capabilities,
  } : emptyModelForm);
  const [variantJsonErrors, setVariantJsonErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addVariant = () => {
    const variants = { ...(form.variants || {}) };
    let key = 'new';
    let i = 1;
    while (variants[key]) {
      key = `new-${i++}`;
    }
    variants[key] = { providerOptions: {} };
    setForm(prev => ({ ...prev, variants }));
  };

  const removeVariant = (key: string) => {
    const variants = { ...(form.variants || {}) };
    delete variants[key];
    setForm(prev => ({
      ...prev,
      variants: Object.keys(variants).length > 0 ? variants : undefined,
    }));
  };

  const renameVariant = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const variants = { ...(form.variants || {}) };
    if (variants[newKey] && newKey !== oldKey) return;
    const entry = variants[oldKey];
    delete variants[oldKey];
    variants[newKey] = entry;
    setForm(prev => ({ ...prev, variants: Object.keys(variants).length > 0 ? variants : undefined }));
  };

  const updateVariantJson = (key: string, raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        setVariantJsonErrors(prev => ({ ...prev, [key]: true }));
        return;
      }
      const variants = { ...(form.variants || {}) };
      variants[key] = { providerOptions: parsed };
      setForm(prev => ({ ...prev, variants }));
      setVariantJsonErrors(prev => ({ ...prev, [key]: false }));
    } catch {
      setVariantJsonErrors(prev => ({ ...prev, [key]: true }));
    }
  };

  const handleSave = async () => {
    if (!form.id.trim() || !form.name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (!model) {
        await createModelMut.mutateAsync({
          providerId,
          body: {
            id: form.id.trim(),
            name: form.name.trim(),
            contextWindow: form.contextWindow,
            maxOutputTokens: form.maxOutputTokens,
            variants: form.variants,
            capabilities: form.capabilities,
          },
        });
      } else {
        await updateModelMut.mutateAsync({
          providerId,
          modelId: model.id,
          body: {
            name: form.name.trim(),
            contextWindow: form.contextWindow,
            maxOutputTokens: form.maxOutputTokens,
            variants: form.variants,
            capabilities: form.capabilities,
          },
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save model');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">
          {model ? `Edit: ${model.name}` : `New Model (${providerName || providerId})`}
        </h3>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !form.id.trim() || !form.name.trim() || Object.values(variantJsonErrors).some(Boolean)}
          >
            {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            <X className="size-3" />
          </Button>
        </div>
      </div>

      {error && (
        <SettingsError>{error}</SettingsError>
      )}

      <div className="space-y-3">
        <div>
          <Label className="text-xs">Model ID</Label>
          <Input
            value={form.id}
            onChange={(e) => setForm(prev => ({ ...prev, id: e.target.value }))}
            disabled={!!model}
            placeholder="e.g., glm-5.3"
            className="mt-1 font-mono"
          />
          {model && (
            <p className="text-xs text-muted-foreground mt-1">ID cannot be changed</p>
          )}
        </div>
        <div>
          <Label className="text-xs">Display Name</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
            placeholder="e.g., GLM-5.3"
            className="mt-1"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Context Window</Label>
            <Input
              type="number"
              value={form.contextWindow}
              onChange={(e) => setForm(prev => ({ ...prev, contextWindow: parseInt(e.target.value) || 0 }))}
              min={1}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Max Output Tokens</Label>
            <Input
              type="number"
              value={form.maxOutputTokens ?? ''}
              onChange={(e) => setForm(prev => ({
                ...prev,
                maxOutputTokens: e.target.value ? parseInt(e.target.value) : undefined,
              }))}
              min={1}
              placeholder="Optional"
              className="mt-1"
            />
          </div>
        </div>

        <Separator className="my-2" />

        <div className="space-y-2">
          <Label className="text-xs font-medium">Capabilities</Label>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch
                checked={form.capabilities?.input?.text ?? false}
                onCheckedChange={(checked) => setForm(prev => updateCapabilities(prev, 'text', checked))}
              />
              <span className="text-xs">Text</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch
                checked={form.capabilities?.input?.image ?? false}
                onCheckedChange={(checked) => setForm(prev => updateCapabilities(prev, 'image', checked))}
              />
              <span className="text-xs">Image</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch
                checked={form.capabilities?.input?.video ?? false}
                onCheckedChange={(checked) => setForm(prev => updateCapabilities(prev, 'video', checked))}
              />
              <span className="text-xs">Video</span>
            </label>
          </div>
          <div>
            <Label className="text-xs">File Types (MIME, comma-separated)</Label>
            <Input
              value={form.capabilities?.input?.file?.join(', ') ?? ''}
              onChange={(e) => setForm(prev => updateFileTypes(prev, e.target.value))}
              placeholder="e.g., application/pdf, text/csv"
              className="mt-1 font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">Structured Output</Label>
            <Select
              value={form.capabilities?.structuredOutput?.mode ?? 'none'}
              onValueChange={(mode) => setForm(prev => updateStructuredOutputMode(prev, mode as 'native' | 'prompt' | 'none'))}
            >
              <SelectTrigger size="sm" className="mt-1 w-full" aria-label="Structured Output">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="none">Default (native)</SelectItem>
                  <SelectItem value="native">Native (json_schema)</SelectItem>
                  <SelectItem value="prompt">Prompt-based (schema in system prompt)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Use Prompt-based for providers that strip JSON schema (GLM, MiniMax). Native works for OpenAI-compatible APIs.
            </p>
          </div>
        </div>

        <Separator className="my-2" />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium">Variants</Label>
            <Button type="button" size="sm" variant="ghost" onClick={addVariant}>
              <Plus className="size-3" />
              Add Variant
            </Button>
          </div>
          {form.variants && Object.keys(form.variants).length > 0 ? (
            <div className="space-y-2">
              {Object.entries(form.variants).map(([key, variant]) => (
                <div key={key} className="border rounded p-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      value={key}
                      onChange={(e) => renameVariant(key, e.target.value)}
                      placeholder="variant name"
                      className="h-7 text-xs font-mono w-24"
                    />
                    <div className="flex-1" />
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => removeVariant(key)}>
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                  <Textarea
                    value={JSON.stringify(variant.providerOptions, null, 2)}
                    onChange={(e) => updateVariantJson(key, e.target.value)}
                    placeholder="{}"
                    className="font-mono text-xs min-h-[60px]"
                    rows={3}
                  />
                  {variantJsonErrors[key] && (
                    <p className="text-xs text-destructive">Invalid JSON</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No variants configured</p>
          )}
        </div>
      </div>
    </div>
  );
}
