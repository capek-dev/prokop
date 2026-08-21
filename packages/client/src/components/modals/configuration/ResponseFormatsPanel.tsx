import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import type { ProkopaiClient, ResponseFormat } from '@prokopai/sdk';
import { useResponseFormatsQuery, useCreateResponseFormat, useUpdateResponseFormat, useDeleteResponseFormat } from '@/hooks/queries';
import { Braces, Plus, Pencil, Trash2, ArrowLeft, Loader2, GripVertical, Code, Eye, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'array', label: 'List' },
  { value: 'object', label: 'Object' },
];

interface FieldDef {
  id: string;
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
  /** For 'object' fields: the nested properties of the object. */
  children?: FieldDef[];
  /** For 'array' fields: the schema of each item in the list. */
  items?: FieldDef;
}

let fieldIdCounter = 0;
function makeFieldId(): string {
  fieldIdCounter += 1;
  return `f${fieldIdCounter}`;
}

function makeField(type: FieldType = 'string', name = ''): FieldDef {
  return {
    id: makeFieldId(),
    name,
    type,
    description: '',
    required: false,
    ...(type === 'object' ? { children: [] } : {}),
    ...(type === 'array' ? { items: makeField('string') } : {}),
  };
}

/**
 * Convert a list of fields into a JSON Schema `properties` map + `required` list.
 * Used both for the root object and nested objects.
 */
function fieldsToSchemaFragment(fields: FieldDef[]): {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
} {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  const seenNames = new Set<string>();

  for (const field of fields) {
    if (!field.name) continue;
    // De-duplicate names: if a field name already exists, append a counter suffix.
    // This prevents sibling properties from overwriting each other when the user
    // hasn't renamed auto-generated defaults (e.g. multiple "field_1").
    let uniqueName = field.name;
    let counter = 2;
    while (seenNames.has(uniqueName)) {
      uniqueName = `${field.name}_${counter}`;
      counter += 1;
    }
    seenNames.add(uniqueName);

    const prop = fieldDefToSchemaProperty(field);
    properties[uniqueName] = prop;
    if (field.required) {
      required.push(uniqueName);
    }
  }

  return { properties, required };
}

/** Convert a single field into its JSON Schema property definition (recursive). */
function fieldDefToSchemaProperty(field: FieldDef): Record<string, unknown> {
  const prop: Record<string, unknown> = { type: field.type };
  if (field.description.trim()) {
    prop.description = field.description.trim();
  }
  if (field.type === 'object' && field.children) {
    const child = fieldsToSchemaFragment(field.children);
    prop.properties = child.properties;
    prop.required = child.required;
    prop.additionalProperties = false;
  }
  if (field.type === 'array' && field.items) {
    prop.items = fieldDefToSchemaProperty(field.items);
  }
  return prop;
}

function fieldsToSchema(fields: FieldDef[]): Record<string, unknown> {
  const { properties, required } = fieldsToSchemaFragment(fields);
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/** Parse a JSON Schema property def (the value of an entry in `properties`) back into a FieldDef. */
function schemaPropertyToField(name: string, def: Record<string, unknown>): FieldDef {
  const rawType = def.type as string;
  const type = (FIELD_TYPES.some(ft => ft.value === rawType) ? rawType : 'string') as FieldType;
  const field: FieldDef = {
    id: makeFieldId(),
    name,
    type,
    description: (def.description as string) ?? '',
    required: false,
  };

  if (type === 'object') {
    const props = (def.properties ?? {}) as Record<string, Record<string, unknown>>;
    const requiredSet = new Set((def.required as string[] | undefined) ?? []);
    field.children = Object.entries(props).map(([childName, childDef]) => {
      const child = schemaPropertyToField(childName, childDef);
      child.required = requiredSet.has(childName);
      return child;
    });
  }
  if (type === 'array' && def.items && typeof def.items === 'object') {
    const itemsDef = def.items as Record<string, unknown>;
    field.items = schemaPropertyToField('', itemsDef);
  }

  return field;
}

function schemaToFields(schema: Record<string, unknown>): FieldDef[] {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, def]) => {
    const field = schemaPropertyToField(name, def);
    field.required = required.has(name);
    return field;
  });
}

function validateJsonSchema(schema: unknown): { valid: boolean; error?: string } {
  if (!schema || typeof schema !== 'object') {
    return { valid: false, error: 'Schema must be a JSON object' };
  }
  const obj = schema as Record<string, unknown>;
  if (obj.type !== 'object') {
    return { valid: false, error: 'Schema must have "type": "object"' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Immutable update helpers for nested field trees.
//
// Paths are arrays of indices. For descending into an array field's `items`,
// we use the sentinel index -1.
// ---------------------------------------------------------------------------

function updateFieldAt(
  fields: FieldDef[],
  indices: number[],
  updater: (f: FieldDef) => FieldDef,
): FieldDef[] {
  const [head, ...rest] = indices;
  return fields.map((field, i) => {
    if (i !== head) return field;
    if (rest.length === 0) {
      return updater(field);
    }
    const [next, ...tail] = rest;
    if (field.type === 'array' && field.items && next === -1) {
      return { ...field, items: updateItemHelper(field.items, tail, updater) };
    }
    if (field.type === 'object' && field.children) {
      return { ...field, children: updateFieldAt(field.children, rest, updater) };
    }
    return field;
  });
}

function updateItemHelper(
  items: FieldDef,
  indices: number[],
  updater: (f: FieldDef) => FieldDef,
): FieldDef {
  if (indices.length === 0) {
    return updater(items);
  }
  const [head, ...rest] = indices;
  if (items.type === 'object' && items.children) {
    return { ...items, children: updateFieldAt(items.children, [head, ...rest], updater) };
  }
  if (items.type === 'array' && items.items && head === -1) {
    return { ...items, items: updateItemHelper(items.items, rest, updater) };
  }
  return items;
}

function removeFieldAt(fields: FieldDef[], indices: number[]): FieldDef[] {
  const [head, ...rest] = indices;
  if (rest.length === 0) {
    return fields.filter((_, i) => i !== head);
  }
  return fields.map((field, i) => {
    if (i !== head) return field;
    const [next, ...tail] = rest;
    void tail;
    if (field.type === 'array' && field.items && next === -1) {
      return field;
    }
    if (field.type === 'object' && field.children) {
      return { ...field, children: removeFieldAt(field.children, rest) };
    }
    return field;
  });
}

/** Append a new field to the children of the field at the given parent path. */
function addChildAt(fields: FieldDef[], parentPath: number[], newField: FieldDef): FieldDef[] {
  return fields.map((field, i) => {
    if (i !== parentPath[0]) return field;
    if (parentPath.length === 1) {
      const children = [...(field.children ?? []), newField];
      return { ...field, children };
    }
    const [next, ...rest] = parentPath.slice(1);
    if (field.type === 'array' && field.items && next === -1) {
      const items = field.items;
      if (items.type === 'object') {
        return { ...field, items: { ...items, children: [...(items.children ?? []), newField] } };
      }
      return field;
    }
    if (field.type === 'object' && field.children) {
      return { ...field, children: addChildAt(field.children, rest, newField) };
    }
    return field;
  });
}

// ---------------------------------------------------------------------------
// FieldRow: a single field editor row, rendered recursively for nesting
// ---------------------------------------------------------------------------

interface FieldRowProps {
  field: FieldDef;
  path: number[];
  onChange: (indices: number[], updater: (f: FieldDef) => FieldDef) => void;
  onRemove: (indices: number[]) => void;
  onAddChild: (parentPath: number[], newField: FieldDef) => void;
  depth: number;
}

function FieldRow({ field, path, onChange, onRemove, onAddChild, depth }: FieldRowProps) {
  const [expanded, setExpanded] = useState(true);
  const isContainer = field.type === 'object' || field.type === 'array';

  const handleTypeChange = (newType: FieldType) => {
    onChange(path, (f) => {
      const updated: FieldDef = { ...f, type: newType };
      if (newType === 'object') {
        if (!updated.children) updated.children = [];
        delete updated.items;
      } else if (newType === 'array') {
        if (!updated.items) updated.items = makeField('string');
        delete updated.children;
      } else {
        delete updated.children;
        delete updated.items;
      }
      return updated;
    });
    if (newType === 'object' || newType === 'array') setExpanded(true);
  };

  const itemsPath = [...path, -1];

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-background">
        <GripVertical className="size-4 text-muted-foreground mt-2 shrink-0" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex gap-2">
            <Input
              value={field.name}
              onChange={(e) => onChange(path, (f) => ({
                ...f,
                name: e.target.value.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''),
              }))}
              placeholder="field_name"
              className="font-mono text-xs h-8"
            />
            <Select value={field.type} onValueChange={(value) => handleTypeChange(value as FieldType)}>
              <SelectTrigger className="w-28 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map(ft => (
                  <SelectItem key={ft.value} value={ft.value}>
                    {ft.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <Input
              value={field.description}
              onChange={(e) => onChange(path, (f) => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)"
              className="text-xs h-7 flex-1"
            />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0 cursor-pointer">
              <Switch
                checked={field.required}
                onCheckedChange={(checked) => onChange(path, (f) => ({ ...f, required: checked }))}
                className="scale-75"
              />
              Required
            </label>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="mt-1.5 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(path)}
        >
          <Trash2 className="size-3" />
        </Button>
      </div>

      {isContainer && (
        <div className="ml-3 sm:ml-4 border-l-2 border-border pl-2 sm:pl-3">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1.5"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight className={`size-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {field.type === 'object'
              ? `Object properties (${field.children?.length ?? 0})`
              : `List item type: ${field.items?.type ?? 'string'}`}
          </button>

          {expanded && field.type === 'object' && (
            <div className="space-y-2">
              {(field.children?.length ?? 0) === 0 && (
                <div className="text-xs text-muted-foreground text-center py-3 border rounded-lg border-dashed">
                  No properties. Add one below.
                </div>
              )}
              {field.children?.map((child, ci) => (
                <FieldRow
                  key={child.id}
                  field={child}
                  path={[...path, ci]}
                  onChange={onChange}
                  onRemove={onRemove}
                  onAddChild={onAddChild}
                  depth={depth + 1}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => onAddChild(path, makeField('string', `field_${(field.children?.length ?? 0) + 1}`))}
              >
                <Plus className="size-3" data-icon="inline-start" />
                Add Property
              </Button>
            </div>
          )}

          {expanded && field.type === 'array' && field.items && (
            <ArrayItemEditor
              itemsField={field.items}
              itemsPath={itemsPath}
              onChange={onChange}
              onAddChild={onAddChild}
              depth={depth + 1}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface ArrayItemEditorProps {
  itemsField: FieldDef;
  itemsPath: number[];
  onChange: (indices: number[], updater: (f: FieldDef) => FieldDef) => void;
  onAddChild: (parentPath: number[], newField: FieldDef) => void;
  depth: number;
}

function ArrayItemEditor({ itemsField, itemsPath, onChange, onAddChild, depth }: ArrayItemEditorProps) {
  const handleTypeChange = (newType: FieldType) => {
    onChange(itemsPath, (f) => {
      const updated: FieldDef = { ...f, type: newType };
      if (newType === 'object') {
        if (!updated.children) updated.children = [];
        delete updated.items;
      } else if (newType === 'array') {
        if (!updated.items) updated.items = makeField('string');
        delete updated.children;
      } else {
        delete updated.children;
        delete updated.items;
      }
      return updated;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 p-2 rounded-lg border border-dashed bg-muted/30">
        <span className="text-xs text-muted-foreground shrink-0">Each list item is:</span>
        <Select value={itemsField.type} onValueChange={(value) => handleTypeChange(value as FieldType)}>
          <SelectTrigger className="w-28 h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map(ft => (
              <SelectItem key={ft.value} value={ft.value}>
                {ft.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {itemsField.type === 'object' && (
        <div className="space-y-2">
          {(itemsField.children?.length ?? 0) === 0 && (
            <div className="text-xs text-muted-foreground text-center py-3 border rounded-lg border-dashed">
              No properties. Add one below.
            </div>
          )}
          {itemsField.children?.map((child, ci) => (
            <FieldRow
              key={child.id}
              field={child}
              path={[...itemsPath, ci]}
              onChange={onChange}
              onRemove={noopRemove}
              onAddChild={onAddChild}
              depth={depth + 1}
            />
          ))}
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => onAddChild(itemsPath, makeField('string', `field_${(itemsField.children?.length ?? 0) + 1}`))}
          >
            <Plus className="size-3" data-icon="inline-start" />
            Add Property
          </Button>
        </div>
      )}

      {itemsField.type === 'array' && itemsField.items && (
        <ArrayItemEditor
          itemsField={itemsField.items}
          itemsPath={[...itemsPath, -1]}
          onChange={onChange}
          onAddChild={onAddChild}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

/** Remove is not meaningful for array items (there's always exactly one item schema). */
function noopRemove(_indices: number[]) {
  void _indices;
}

// ---------------------------------------------------------------------------
// Main Panel component
// ---------------------------------------------------------------------------

export function ResponseFormatsPanel({ sdkClient }: PanelProps) {
  const { data: formatsData, isLoading: loading } = useResponseFormatsQuery(sdkClient);
  const createMut = useCreateResponseFormat(sdkClient);
  const updateMut = useUpdateResponseFormat(sdkClient);
  const deleteMut = useDeleteResponseFormat(sdkClient);
  const formats: ResponseFormat[] = formatsData?.formats ?? [];
  const [error, setError] = useState<string | null>(null);

  const [editingFormat, setEditingFormat] = useState<ResponseFormat | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [rawMode, setRawMode] = useState(false);
  const [editSchema, setEditSchema] = useState('');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleCreate = () => {
    setIsCreating(true);
    setEditingFormat(null);
    setEditName('');
    setEditDescription('');
    setRawMode(false);
    setFields([]);
    setEditSchema(JSON.stringify({ type: 'object', properties: {}, required: [], additionalProperties: false }, null, 2));
    setSchemaError(null);
    setError(null);
  };

  const handleEdit = (format: ResponseFormat) => {
    setEditingFormat(format);
    setIsCreating(false);
    setEditName(format.name);
    setEditDescription(format.description ?? '');
    setRawMode(false);
    const parsedFields = schemaToFields(format.schema as Record<string, unknown>);
    setFields(parsedFields);
    setEditSchema(JSON.stringify(format.schema, null, 2));
    setSchemaError(null);
    setError(null);
  };

  const syncFieldsToRaw = useCallback((newFields: FieldDef[]) => {
    const schema = fieldsToSchema(newFields);
    setEditSchema(JSON.stringify(schema, null, 2));
    setSchemaError(null);
  }, []);

  const syncRawToFields = useCallback((raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.type === 'object' && parsed.properties && typeof parsed.properties === 'object') {
        setFields(schemaToFields(parsed));
        setSchemaError(null);
      } else {
        setSchemaError('Schema must have "type": "object" with "properties"');
      }
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : 'Invalid JSON');
    }
  }, []);

  const handleFieldChange = (indices: number[], updater: (f: FieldDef) => FieldDef) => {
    setFields(prev => {
      const next = updateFieldAt(prev, indices, updater);
      syncFieldsToRaw(next);
      return next;
    });
  };

  const handleFieldRemove = (indices: number[]) => {
    setFields(prev => {
      const next = removeFieldAt(prev, indices);
      syncFieldsToRaw(next);
      return next;
    });
  };

  const handleAddField = () => {
    setFields(prev => {
      const next: FieldDef[] = [...prev, makeField('string', `field_${prev.length + 1}`)];
      syncFieldsToRaw(next);
      return next;
    });
  };

  const handleAddChild = (parentPath: number[], newField: FieldDef) => {
    setFields(prev => {
      const next = parentPath.length === 0
        ? [...prev, newField]
        : addChildAt(prev, parentPath, newField);
      syncFieldsToRaw(next);
      return next;
    });
  };

  const handleRawSchemaChange = (value: string) => {
    setEditSchema(value);
    syncRawToFields(value);
  };

  const handleSave = async () => {
    if (!editName.trim()) return;
    let parsedSchema: Record<string, unknown>;
    try {
      parsedSchema = JSON.parse(editSchema);
    } catch {
      setSchemaError('Invalid JSON - please fix before saving');
      return;
    }
    const validation = validateJsonSchema(parsedSchema);
    if (!validation.valid) {
      setSchemaError(validation.error ?? null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (isCreating) {
        await createMut.mutateAsync({
          name: editName.trim(),
          schema: parsedSchema,
          ...(editDescription.trim() ? { description: editDescription.trim() } : {}),
        });
      } else if (editingFormat) {
        await updateMut.mutateAsync({
          id: editingFormat.id,
          body: {
            name: editName.trim(),
            schema: parsedSchema,
            ...(editDescription.trim() ? { description: editDescription.trim() } : {}),
          },
        });
      }
      setIsCreating(false);
      setEditingFormat(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete';
      setError(message);
      toast.error('Failed to delete response format', { description: message });
    }
  };

  const handleCancel = () => {
    setIsCreating(false);
    setEditingFormat(null);
    setEditName('');
    setEditDescription('');
    setEditSchema('');
    setFields([]);
    setSchemaError(null);
  };

  if (isCreating || editingFormat) {
    return (
      <div className="p-3 sm:p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={handleCancel}>
              <ArrowLeft className="size-4" />
            </Button>
            <h3 className="text-sm font-medium">
              {isCreating ? 'New Response Format' : `Edit: ${editingFormat?.name}`}
            </h3>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving || !editName.trim()}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
          </Button>
        </div>

        {error && (
          <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
        )}

        <div>
          <label className="text-sm font-medium mb-1 block">Name</label>
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="My Format"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Description</label>
          <Input
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="What this format is used for"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Fields</label>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1.5 text-xs px-2"
                onClick={() => setRawMode(!rawMode)}
              >
                {rawMode ? <Eye className="size-3" /> : <Code className="size-3" />}
                {rawMode ? 'Visual' : 'Raw JSON'}
              </Button>
            </div>
          </div>

          {rawMode ? (
            <>
              <textarea
                value={editSchema}
                onChange={(e) => handleRawSchemaChange(e.target.value)}
                className={`w-full h-64 p-3 rounded-lg border font-mono text-sm resize-y ${
                  schemaError ? 'border-destructive bg-destructive/5' : 'bg-background'
                }`}
                placeholder='{ "type": "object", "properties": {...} }'
              />
              {schemaError && (
                <p className="text-xs text-destructive mt-1">{schemaError}</p>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {fields.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg border-dashed">
                  No fields yet. Add one below.
                </div>
              )}
              {fields.map((field, i) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  path={[i]}
                  onChange={handleFieldChange}
                  onRemove={handleFieldRemove}
                  onAddChild={handleAddChild}
                  depth={0}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-1"
                onClick={handleAddField}
              >
                <Plus className="size-3" data-icon="inline-start" />
                Add Field
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {formats.length} format{formats.length !== 1 ? 's' : ''}
        </p>
        <Button size="sm" onClick={handleCreate}>
          <Plus className="size-3" data-icon="inline-start" />
          New Format
        </Button>
      </div>

      {error && (
        <div className="p-2 rounded bg-destructive/10 text-sm text-destructive">{error}</div>
      )}

      {formats.length === 0 ? (
        <div className="text-center py-8 text-sm text-muted-foreground">
          No response formats yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {formats.map((format) => {
            const propCount = Object.keys(
              (format.schema as Record<string, unknown>)?.properties
                ? ((format.schema as Record<string, unknown>).properties as Record<string, unknown>)
                : {},
            ).length;

            return (
              <div
                key={format.id}
                className="flex items-center justify-between p-2.5 sm:p-3 rounded-lg border hover:bg-muted/50 cursor-pointer min-w-0 overflow-hidden"
                onClick={() => handleEdit(format)}
              >
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <Braces className="size-4 text-muted-foreground shrink-0 hidden sm:block" />
                  <div className="flex flex-col flex-1 min-w-0 gap-0.5 sm:gap-1 overflow-hidden">
                    <span className="text-sm font-medium truncate">{format.name}</span>
                    {format.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">{format.description}</div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {propCount} propert{propCount !== 1 ? 'ies' : 'y'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => handleEdit(format)}
                    title="Edit format"
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => setDeleteTarget({ id: format.id, name: format.name })}
                    title="Delete format"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Response Format"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
        loading={deleteMut.isPending}
      />
    </div>
  );
}
