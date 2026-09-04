import { useState } from 'react';
import { Check, GitBranch, Loader2, Plus, X } from 'lucide-react';
import type { GitWorktreeRef } from '@prokopai/sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

interface WorktreeCreateFormProps {
  refs: GitWorktreeRef[];
  existingWorktreeNames: string[];
  refsLoading: boolean;
  pending: boolean;
  onCancel?: () => void;
  onCreate: (input: { name: string; branch: string }, complete: () => void) => void;
}

function suggestedWorktreeName(branchName: string, existingNames: string[]): string {
  if (!branchName) return '';
  const names = new Set(existingNames);
  if (!names.has(branchName)) return branchName;
  if (branchName.startsWith('origin/')) {
    const short = branchName.slice('origin/'.length);
    if (!names.has(short)) return short;
  }

  let suffix = 2;
  while (names.has(`${branchName}-${suffix}`)) suffix += 1;
  return `${branchName}-${suffix}`;
}

/**
 * Compact create form rendered inside the checkout popover: searchable branch
 * list on top, prefilled name input below. Checked-out branches are listed
 * but disabled since git refuses two worktrees on one branch.
 */
export function WorktreeCreateForm({
  refs,
  existingWorktreeNames,
  refsLoading,
  pending,
  onCancel,
  onCreate,
}: WorktreeCreateFormProps) {
  const localRefs = refs.filter((option) => option.kind === 'local');
  const defaultBranch = localRefs.find((option) => !option.checkedOut)?.ref ?? '';
  const [selectedBranch, setSelectedBranch] = useState('');
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const branch = selectedBranch || defaultBranch;
  const selectedRef = localRefs.find((option) => option.ref === branch);
  const name = nameOverride
    ?? suggestedWorktreeName(selectedRef?.name ?? '', existingWorktreeNames);
  const trimmedName = name.trim();
  const nameConflict = existingWorktreeNames.includes(trimmedName);
  const canCreate = Boolean(trimmedName && branch && !nameConflict && !pending);

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: trimmedName, branch }, () => setNameOverride(null));
  };

  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground">New worktree</span>
        {onCancel && !pending && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onCancel}
            aria-label="Cancel creating worktree"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      <Command>
        <CommandInput placeholder="Search branches…" />
        <CommandList className="max-h-48">
          <CommandEmpty>{refsLoading ? 'Loading branches…' : 'No branches found.'}</CommandEmpty>
          <CommandGroup>
            {localRefs.map((option) => (
              <CommandItem
                key={option.ref}
                value={option.ref}
                disabled={option.checkedOut}
                showCheck={false}
                onSelect={() => {
                  setSelectedBranch(option.ref);
                  setNameOverride(null);
                }}
              >
                <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{option.name}</span>
                {option.current && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">current</span>
                )}
                {option.checkedOut && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">in use</span>
                )}
                {option.ref === branch && (
                  <Check className={option.current || option.checkedOut ? '' : 'ml-auto'} />
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>

      <div className="flex items-center gap-1.5 px-1">
        <Input
          value={name}
          onChange={(event) => setNameOverride(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canCreate) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Worktree name"
          className="h-7 text-xs"
          disabled={pending || !branch}
          aria-label="Worktree name"
          aria-invalid={nameConflict}
        />
        <Button type="button" size="sm" onClick={submit} disabled={!canCreate} className="shrink-0">
          {pending ? (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          ) : (
            <Plus data-icon="inline-start" />
          )}
          Create
        </Button>
      </div>

      {nameConflict && (
        <p role="alert" className="px-1 text-xs text-destructive">
          A worktree named &quot;{trimmedName}&quot; already exists.
        </p>
      )}
    </div>
  );
}
