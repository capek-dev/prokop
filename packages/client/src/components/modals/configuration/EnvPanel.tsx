import { useState, useMemo } from 'react';
import type { ProkopaiClient, ToolEnvVarStatus, EnvVarSource } from '@prokopai/sdk';
import { useToolEnvVarsQuery, useToolSetEnvVar, useToolClearEnvVar } from '@/hooks/queries';
import {
  Terminal, Check, X, Trash2, Eye, EyeOff, Loader2, Search,
  Plus, ChevronDown, ExternalLink, Settings2, Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface PanelProps {
  sdkClient: ProkopaiClient | null;
}

interface Group {
  label: string;
  source: EnvVarSource;
  vars: ToolEnvVarStatus[];
}

const SOURCE_ICONS = {
  preset: Settings2,
  custom: Terminal,
  tool: Wrench,
} as const;

function groupVars(vars: ToolEnvVarStatus[]): Group[] {
  const byCategory = new Map<string, ToolEnvVarStatus[]>();

  for (const v of vars) {
    let label: string;
    if (v.source === 'preset' && v.category) {
      label = v.category;
    } else if (v.source === 'custom') {
      label = 'Custom';
    } else if (v.source === 'tool') {
      label = 'Tools';
    } else {
      label = 'Other';
    }

    const arr = byCategory.get(label) || [];
    arr.push(v);
    byCategory.set(label, arr);
  }

  // Collect preset categories in their defined order (first-seen), then Tools, then Custom
  const order: Record<string, number> = {};
  let idx = 0;
  const groups: Group[] = [];

  for (const v of vars) {
    if (v.source === 'preset' && v.category && !(v.category in order)) {
      order[v.category] = idx;
      idx++;
    }
  }
  order['Tools'] = idx;
  idx++;
  order['Custom'] = idx;

  for (const [label, groupVars] of byCategory) {
    groups.push({
      label,
      source: groupVars[0]?.source ?? 'custom',
      vars: groupVars,
    });
  }

  groups.sort((a, b) => (order[a.label] ?? 99) - (order[b.label] ?? 99));
  return groups;
}

export function EnvPanel({ sdkClient }: PanelProps) {
  const { data: envData, isLoading: loading } = useToolEnvVarsQuery(sdkClient);
  const setEnvVarMut = useToolSetEnvVar(sdkClient);
  const clearEnvVarMut = useToolClearEnvVar(sdkClient);
  const envVars: ToolEnvVarStatus[] = envData?.envVars ?? [];

  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [valueInput, setValueInput] = useState('');
  const [showValue, setShowValue] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // Custom var creation
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [showNewValue, setShowNewValue] = useState(false);

  // Collapsible group state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!filter.trim()) return envVars;
    const lower = filter.toLowerCase();
    return envVars.filter(
      (v) =>
        v.key.toLowerCase().includes(lower) ||
        v.description?.toLowerCase().includes(lower) ||
        v.category?.toLowerCase().includes(lower),
    );
  }, [envVars, filter]);

  const groups = useMemo(() => groupVars(filtered), [filtered]);
  const configuredCount = envVars.filter((v) => v.configured).length;

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const handleSetValue = async (key: string) => {
    if (!valueInput.trim()) return;
    setActionLoading(key);
    try {
      await setEnvVarMut.mutateAsync({ key, value: valueInput.trim() });
      setEditingKey(null);
      setValueInput('');
      setShowValue(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set env var');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClearValue = async (key: string) => {
    setActionLoading(key);
    try {
      await clearEnvVarMut.mutateAsync(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear env var');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddCustom = async () => {
    const key = newKey.trim();
    const val = newValue.trim();
    if (!key || !val) return;

    // Basic key validation: uppercase + underscores
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      setError('Variable key must be UPPERCASE_LETTERS with underscores (e.g. MY_CUSTOM_KEY)');
      return;
    }

    setActionLoading(`__new__`);
    try {
      await setEnvVarMut.mutateAsync({ key, value: val });
      setNewKey('');
      setNewValue('');
      setShowNewValue(false);
      setShowAddCustom(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add env var');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Manage environment variables for integrations. Values are stored in{' '}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">~/.jean2/.env</code> and applied at runtime.
        </p>
        {envVars.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {configuredCount} of {envVars.length} configured
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between gap-2 p-2 rounded bg-destructive/10 text-sm text-destructive">
          <span className="break-words">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)} className="shrink-0 h-6 px-2">
            <X className="size-3" />
          </Button>
        </div>
      )}

      {/* Filter + Add Custom */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter variables..."
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          onClick={() => setShowAddCustom(!showAddCustom)}
        >
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>

      {/* Add Custom Variable form */}
      {showAddCustom && (
        <div className="rounded-lg border border-dashed p-3 space-y-2 bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground">Add custom environment variable</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              placeholder="MY_CUSTOM_KEY"
              className="h-8 text-sm font-mono flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              autoFocus
            />
            <div className="relative flex-1">
              <Input
                type={showNewValue ? 'text' : 'password'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Value..."
                className="h-8 text-sm pr-8"
                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-8 w-8"
                onClick={() => setShowNewValue(!showNewValue)}
              >
                {showNewValue ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </Button>
            </div>
            <Button
              size="sm"
              className="h-8"
              onClick={handleAddCustom}
              disabled={!newKey.trim() || !newValue.trim() || actionLoading === '__new__'}
            >
              {actionLoading === '__new__' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              <span className="hidden sm:inline">Save</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setShowAddCustom(false);
                setNewKey('');
                setNewValue('');
              }}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Groups */}
      {groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
          <Terminal className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {envVars.length === 0
              ? 'No environment variables yet. Add one below.'
              : 'No variables match your filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const Icon = (SOURCE_ICONS as Record<string, typeof Terminal>)[group.source] ?? Terminal;
            const isCollapsed = collapsedGroups.has(group.label);
            const groupConfiguredCount = group.vars.filter((v) => v.configured).length;

            return (
              <Collapsible
                key={group.label}
                open={!isCollapsed}
                onOpenChange={() => toggleGroup(group.label)}
              >
                <div className="rounded-lg border overflow-hidden">
                  <CollapsibleTrigger className="w-full flex items-center justify-between p-2.5 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium truncate">{group.label}</span>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {groupConfiguredCount}/{group.vars.length}
                      </Badge>
                    </div>
                    <ChevronDown
                      className={`size-4 text-muted-foreground shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="divide-y border-t">
                      {group.vars.map((envVar) => (
                        <EnvVarRow
                          key={envVar.key}
                          envVar={envVar}
                          isEditing={editingKey === envVar.key}
                          valueInput={valueInput}
                          showValue={showValue}
                          actionLoading={actionLoading}
                          onEdit={() => {
                            setEditingKey(envVar.key);
                            setValueInput('');
                            setShowValue(false);
                          }}
                          onCancelEdit={() => {
                            setEditingKey(null);
                            setValueInput('');
                          }}
                          onValueChange={setValueInput}
                          onToggleShowValue={() => setShowValue(!showValue)}
                          onSetValue={() => handleSetValue(envVar.key)}
                          onClearValue={() => handleClearValue(envVar.key)}
                        />
                      ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ========================================
// EnvVarRow component
// ========================================

interface EnvVarRowProps {
  envVar: ToolEnvVarStatus;
  isEditing: boolean;
  valueInput: string;
  showValue: boolean;
  actionLoading: string | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onValueChange: (val: string) => void;
  onToggleShowValue: () => void;
  onSetValue: () => void;
  onClearValue: () => void;
}

function EnvVarRow({
  envVar,
  isEditing,
  valueInput,
  showValue,
  actionLoading,
  onEdit,
  onCancelEdit,
  onValueChange,
  onToggleShowValue,
  onSetValue,
  onClearValue,
}: EnvVarRowProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="flex flex-col gap-2">
        {/* Info */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm font-medium break-all">{envVar.key}</code>
            <Badge variant={envVar.configured ? 'default' : 'secondary'}>
              {envVar.configured ? 'Configured' : 'Not set'}
            </Badge>
            {envVar.sensitive && (
              <Badge variant="outline" className="text-xs">
                Sensitive
              </Badge>
            )}
          </div>
          {envVar.description && (
            <p className="text-xs text-muted-foreground">{envVar.description}</p>
          )}
          {envVar.usedBy && envVar.usedBy.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Required by: {envVar.usedBy.join(', ')}
            </p>
          )}
          {envVar.link && (
            <a
              href={envVar.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              {envVar.link.label}
              <ExternalLink className="size-3" />
            </a>
          )}
          {envVar.configured && !envVar.sensitive && envVar.value && (
            <p className="text-xs font-mono text-muted-foreground break-all">
              Current: {envVar.value}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {isEditing ? (
            <div className="flex items-center gap-2 w-full">
              <div className="relative flex-1 min-w-0">
                <Input
                  type={envVar.sensitive && !showValue ? 'password' : 'text'}
                  value={valueInput}
                  onChange={(e) => onValueChange(e.target.value)}
                  placeholder={envVar.example ? `e.g. ${envVar.example}` : 'Enter value...'}
                  className="w-full h-8 text-sm pr-8"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSetValue();
                    if (e.key === 'Escape') onCancelEdit();
                  }}
                  autoFocus
                />
                {envVar.sensitive && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-8 w-8"
                    onClick={onToggleShowValue}
                  >
                    {showValue ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                onClick={onSetValue}
                disabled={!valueInput.trim() || actionLoading === envVar.key}
                className="shrink-0"
              >
                {actionLoading === envVar.key ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Check className="size-3" />
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelEdit}
                className="shrink-0"
              >
                <X className="size-3" />
              </Button>
            </div>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onEdit}
                disabled={actionLoading === envVar.key}
              >
                {envVar.configured ? 'Update' : 'Set'}
              </Button>
              {envVar.configured && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClearValue}
                  disabled={actionLoading === envVar.key}
                >
                  {actionLoading === envVar.key ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
